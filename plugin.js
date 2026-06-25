(function () {
  'use strict';

  var DEFAULT_SETTINGS = {
    endpoint: 'ws://127.0.0.1:4455',
    password: '',
    operation: 'toggle_stream',
    sceneName: '',
    sourceName: '',
    sceneItemName: '',
    volumeStepDb: 1,
    sceneCollectionName: '',
    profileName: '',
    connectionPresetsJson: '',
    connectionPresetName: '',
    confirmDangerous: false,
    filterName: '',
    filterEnabled: true,
    visibilityMode: 'toggle',
    volumeSetDb: '',
    transitionName: ''
  };

  var streamDockSocket = null;
  var pluginUuid = null;
  var obsSocket = null;
  var identified = false;
  var reconnectTimer = null;
  var contexts = {};
  var pendingRequests = {};
  var requestId = 1;
  var obsState = { streaming: false, recording: false, virtualCamera: false, studioMode: false, streamStartedAt: 0, recordStartedAt: 0, levels: {}, currentScene: '', lastError: '', stats: {} };
  var confirmUntil = {};
  var statsTimer = null;
  var titleTimer = null;

  var ACTION_OPERATIONS = {
    'local.streamdock.obs.stream': 'toggle_stream',
    'local.streamdock.obs.record': 'toggle_record',
    'local.streamdock.obs.scene': 'switch_scene',
    'local.streamdock.obs.mute': 'toggle_mute',
    'local.streamdock.obs.volume': 'volume',
    'local.streamdock.obs.replay': 'save_replay',
    'local.streamdock.obs.visibility': 'toggle_visibility',
    'local.streamdock.obs.transition': 'studio_transition',
    'local.streamdock.obs.scenecollection': 'switch_scene_collection',
    'local.streamdock.obs.profile': 'switch_profile',
    'local.streamdock.obs.meter': 'meter',
    'local.streamdock.obs.filter': 'toggle_filter',
    'local.streamdock.obs.stats': 'stats',
    'local.streamdock.obs.virtualcam': 'toggle_virtual_camera',
    'local.streamdock.obs.studiomode': 'toggle_studio_mode',
    'local.streamdock.obs.diagnostics': 'diagnostics'
  };

  function parseJson(value, fallback) {
    try {
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch (error) {
      return fallback;
    }
  }

  function sendToStreamDock(message) {
    if (streamDockSocket && streamDockSocket.readyState === WebSocket.OPEN) {
      streamDockSocket.send(JSON.stringify(message));
    }
  }

  function setTitle(context, title) {
    sendToStreamDock({ event: 'setTitle', context: context, payload: { title: title } });
  }

  function setImage(context, image) {
    sendToStreamDock({ event: 'setImage', context: context, payload: { image: image } });
  }

  function contextSettings(context) {
    var contextState = contexts[context] || {};
    var actionDefault = ACTION_OPERATIONS[contextState.action] || DEFAULT_SETTINGS.operation;
    return applyConnectionPreset(Object.assign({}, DEFAULT_SETTINGS, { operation: actionDefault }, contextState.settings || {}));
  }

  function applyConnectionPreset(settings) {
    if (!settings.connectionPresetsJson || !settings.connectionPresetName) {
      return settings;
    }
    try {
      var presets = JSON.parse(settings.connectionPresetsJson);
      var preset = presets && presets[settings.connectionPresetName];
      if (preset) {
        return Object.assign({}, settings, preset, {
          connectionPresetsJson: settings.connectionPresetsJson,
          connectionPresetName: settings.connectionPresetName
        });
      }
    } catch (error) {
      return settings;
    }
    return settings;
  }

  function titleFor(context) {
    var settings = contextSettings(context);
    if (!obsSocket || obsSocket.readyState !== WebSocket.OPEN || !identified) {
      return 'OBS\noffline';
    }
    if (settings.operation === 'diagnostics') {
      return 'OBS\n' + (identified ? 'ok' : 'offline') + '\n' + (obsState.lastError || formatStats());
    }
    if (settings.operation === 'switch_scene') {
      return 'Scene\n' + (obsState.currentScene || settings.sceneName || 'unset');
    }
    if (settings.operation === 'toggle_record' || settings.operation === 'start_record' || settings.operation === 'stop_record') {
      return obsState.recording ? 'Record\n' + formatElapsed(obsState.recordStartedAt) : 'Record\noff';
    }
    if (settings.operation === 'stats') {
      return formatStats();
    }
    if (settings.operation === 'toggle_virtual_camera') {
      return obsState.virtualCamera ? 'VCam\non' : 'VCam\noff';
    }
    if (settings.operation === 'toggle_studio_mode') {
      return obsState.studioMode ? 'Studio\non' : 'Studio\noff';
    }
    if (settings.operation === 'toggle_mute') {
      return 'Mute\n' + (settings.sourceName || 'unset');
    }
    if (settings.operation === 'volume') {
      return 'Vol\n' + (settings.sourceName || 'unset');
    }
    if (settings.operation === 'meter') {
      return 'Meter\n' + Math.round(obsState.levels[settings.sourceName] || 0) + '%';
    }
    if (settings.operation === 'save_replay') {
      return 'Replay\nsave';
    }
    if (settings.operation === 'toggle_visibility') {
      return 'Show\n' + (settings.sceneItemName || settings.sourceName || 'unset');
    }
    if (settings.operation === 'studio_transition') {
      return 'Trans\n' + (settings.transitionName || 'go');
    }
    if (settings.operation === 'switch_scene_collection') {
      return 'Coll\n' + (settings.sceneCollectionName || 'unset');
    }
    if (settings.operation === 'switch_profile') {
      return 'Profile\n' + (settings.profileName || 'unset');
    }
    if (settings.operation === 'toggle_stream' || settings.operation === 'start_stream' || settings.operation === 'stop_stream') {
      return obsState.streaming ? 'Stream\n' + formatElapsed(obsState.streamStartedAt) : 'Stream\noff';
    }
    return obsState.streaming ? 'Stream\n' + formatElapsed(obsState.streamStartedAt) : 'Stream\noff';
  }

  function formatStats() {
    var stats = obsState.stats || {};
    var fps = stats.activeFps ? Math.round(stats.activeFps) + 'fps' : '';
    var cpu = stats.cpuUsage ? Math.round(stats.cpuUsage) + '% CPU' : '';
    var render = stats.renderTotalFrames ? String(stats.renderTotalFrames) + 'f' : '';
    return ['Stats', fps || cpu || render || 'waiting', cpu].filter(Boolean).join('\n');
  }

  function formatElapsed(startedAt) {
    if (!startedAt) {
      return 'on';
    }
    var total = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = total % 60;
    return [
      hours,
      minutes < 10 ? '0' + minutes : String(minutes),
      seconds < 10 ? '0' + seconds : String(seconds)
    ].join(':');
  }

  function refreshTitles() {
    Object.keys(contexts).forEach(function (context) {
      setTitle(context, titleFor(context));
      setImage(context, imageFor(context));
    });
  }

  function imageFor(context) {
    var settings = contextSettings(context);
    if (!obsSocket || obsSocket.readyState !== WebSocket.OPEN || !identified) {
      return svgImage('#31343b', '#aeb7c2', 'OBS', 'OFF', 0);
    }
    if (settings.operation === 'toggle_record' || settings.operation === 'start_record' || settings.operation === 'stop_record') {
      return svgImage(obsState.recording ? '#b4232a' : '#383838', '#ffffff', 'REC', obsState.recording ? 'ON' : 'OFF', obsState.recording ? 100 : 0);
    }
    if (settings.operation === 'toggle_mute') {
      return svgImage('#283745', '#ffffff', obsState.lastMute ? 'MUTE' : 'AUD', settings.sourceName || '', obsState.lastMute ? 100 : 0);
    }
    if (settings.operation === 'meter') {
      var level = Math.round(obsState.levels[settings.sourceName] || 0);
      return svgImage(level > 70 ? '#b7791f' : '#254d3a', '#ffffff', String(level), 'LEVEL', level);
    }
    if (settings.operation === 'switch_scene') {
      return svgImage('#273b57', '#ffffff', 'SCN', obsState.currentScene || settings.sceneName || '', 100);
    }
    return svgImage(obsState.streaming ? '#22543d' : '#383838', '#ffffff', 'LIVE', obsState.streaming ? 'ON' : 'OFF', obsState.streaming ? 100 : 0);
  }

  function svgImage(background, foreground, main, sub, fillPercent) {
    var fill = Math.max(0, Math.min(100, Number(fillPercent) || 0));
    var barHeight = Math.round(116 * fill / 100);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">' +
      '<rect width="144" height="144" rx="20" fill="' + background + '"/>' +
      '<rect x="14" y="' + (124 - barHeight) + '" width="116" height="' + barHeight + '" rx="10" fill="' + foreground + '" opacity="0.18"/>' +
      '<text x="72" y="66" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="' + foreground + '">' + escapeSvg(main) + '</text>' +
      '<text x="72" y="99" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="' + foreground + '">' + escapeSvg(truncateImageText(sub)) + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg);
  }

  function truncateImageText(value) {
    value = String(value || '');
    return value.length > 10 ? value.slice(0, 10) : value;
  }

  function escapeSvg(value) {
    return String(value || '').replace(/[&<>"]/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch];
    });
  }

  function logMessage(message) {
    sendToStreamDock({ event: 'logMessage', payload: { message: '[streamdock-obs] ' + message } });
  }

  function textToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var text = '';
    for (var i = 0; i < bytes.length; i += 1) {
      text += String.fromCharCode(bytes[i]);
    }
    return btoa(text);
  }

  function sha256Base64(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(textToBase64);
  }

  function obsAuth(password, challenge, salt) {
    return sha256Base64(password + salt).then(function (secret) {
      return sha256Base64(secret + challenge);
    });
  }

  function connectObs(settings) {
    settings = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    if (obsSocket && (obsSocket.readyState === WebSocket.OPEN || obsSocket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    clearTimeout(reconnectTimer);
    identified = false;
    obsSocket = new WebSocket(settings.endpoint);

    obsSocket.onmessage = function (event) {
      var message = parseJson(event.data, {});
      if (message.op === 0) {
        identify(settings, message.d || {});
      } else if (message.op === 2) {
        identified = true;
        obsState.lastError = '';
        obsRequest('GetStreamStatus', {}, function (data) {
          updateOutputState('stream', !!data.outputActive, outputDurationMs(data));
          refreshTitles();
        });
        obsRequest('GetRecordStatus', {}, function (data) {
          updateOutputState('record', !!data.outputActive, outputDurationMs(data));
          refreshTitles();
        });
        obsRequest('GetCurrentProgramScene', {}, function (data) {
          obsState.currentScene = data.currentProgramSceneName || '';
          refreshTitles();
        });
        obsRequest('GetVirtualCamStatus', {}, function (data) {
          obsState.virtualCamera = !!data.outputActive;
          refreshTitles();
        });
        obsRequest('GetStudioModeEnabled', {}, function (data) {
          obsState.studioMode = !!data.studioModeEnabled;
          refreshTitles();
        });
        pollStats();
        startTitleTimer();
        refreshTitles();
      } else if (message.op === 7 && message.d) {
        var handler = pendingRequests[message.d.requestId];
        delete pendingRequests[message.d.requestId];
        if (handler && message.d.requestStatus && message.d.requestStatus.result) {
          handler(message.d.responseData || {});
        }
        if (message.d.requestStatus && !message.d.requestStatus.result) {
          obsState.lastError = message.d.requestStatus.comment || 'request failed';
          logMessage(obsState.lastError);
          refreshTitles();
        }
      } else if (message.op === 5 && message.d) {
        handleObsEvent(message.d);
      }
    };

    obsSocket.onclose = function () {
      identified = false;
      clearTimeout(statsTimer);
      statsTimer = null;
      obsState.lastError = 'connection closed';
      logMessage('connection closed');
      refreshTitles();
      reconnectTimer = setTimeout(function () {
        connectObs(settings);
      }, 3000);
    };

    obsSocket.onerror = function () {
      identified = false;
      obsState.lastError = 'connection error';
      logMessage('connection error');
      refreshTitles();
    };
  }

  function identify(settings, hello) {
    var auth = hello.authentication;
    var payload = { rpcVersion: 1, eventSubscriptions: 0xFFFFFFFF };
    var sendIdentify = function () {
      obsSocket.send(JSON.stringify({ op: 1, d: payload }));
    };
    if (auth && auth.challenge && auth.salt && settings.password) {
      obsAuth(settings.password, auth.challenge, auth.salt).then(function (authentication) {
        payload.authentication = authentication;
        sendIdentify();
      });
    } else {
      sendIdentify();
    }
  }

  function obsRequest(type, data, onSuccess) {
    if (!obsSocket || obsSocket.readyState !== WebSocket.OPEN || !identified) {
      refreshTitles();
      return;
    }
    var id = String(requestId++);
    pendingRequests[id] = typeof onSuccess === 'function' ? onSuccess : null;
    obsSocket.send(JSON.stringify({
      op: 6,
      d: {
        requestType: type,
        requestId: id,
        requestData: data || {}
      }
    }));
  }

  function pollStats() {
    if (!identified) {
      return;
    }
    clearTimeout(statsTimer);
    obsRequest('GetStats', {}, function (data) {
      obsState.stats = data || {};
      refreshTitles();
    });
    statsTimer = setTimeout(pollStats, 5000);
  }

  function startTitleTimer() {
    if (titleTimer) {
      return;
    }
    titleTimer = setInterval(function () {
      if (obsState.streaming || obsState.recording) {
        refreshTitles();
      }
    }, 1000);
  }

  function updateOutputState(kind, active, durationMs) {
    var startedKey = kind === 'stream' ? 'streamStartedAt' : 'recordStartedAt';
    var activeKey = kind === 'stream' ? 'streaming' : 'recording';
    obsState[activeKey] = !!active;
    if (active) {
      var duration = Number(durationMs);
      obsState[startedKey] = Number.isFinite(duration) && duration > 0 ? Date.now() - duration : (obsState[startedKey] || Date.now());
    } else {
      obsState[startedKey] = 0;
    }
  }

  function outputDurationMs(data) {
    var duration = Number(data && data.outputDuration);
    if (Number.isFinite(duration) && duration > 0) {
      return duration;
    }
    var timecode = String(data && data.outputTimecode || '');
    var match = timecode.match(/^(\d+):(\d{2}):(\d{2})(?:[.:](\d+))?/);
    if (!match) {
      return 0;
    }
    var ms = Number(match[4] || 0);
    if (match[4] && match[4].length === 2) {
      ms *= 10;
    }
    return ((Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3])) * 1000 + ms;
  }

  function handleObsEvent(event) {
    if (event.eventType === 'StreamStateChanged') {
      updateOutputState('stream', !!(event.eventData && event.eventData.outputActive), outputDurationMs(event.eventData));
    }
    if (event.eventType === 'RecordStateChanged') {
      updateOutputState('record', !!(event.eventData && event.eventData.outputActive), outputDurationMs(event.eventData));
    }
    if (event.eventType === 'CurrentProgramSceneChanged') {
      obsState.currentScene = event.eventData && event.eventData.sceneName || '';
    }
    if (event.eventType === 'VirtualcamStateChanged') {
      obsState.virtualCamera = !!(event.eventData && event.eventData.outputActive);
    }
    if (event.eventType === 'StudioModeStateChanged') {
      obsState.studioMode = !!(event.eventData && event.eventData.studioModeEnabled);
    }
    if (event.eventType === 'InputVolumeMeters' && event.eventData && Array.isArray(event.eventData.inputs)) {
      event.eventData.inputs.forEach(function (input) {
        var level = 0;
        if (Array.isArray(input.inputLevelsMul) && input.inputLevelsMul[0]) {
          level = Math.max.apply(Math, input.inputLevelsMul[0]) * 100;
        }
        obsState.levels[input.inputName] = level;
      });
    }
    if (event.eventType === 'InputMuteStateChanged' && event.eventData) {
      obsState.lastMute = !!event.eventData.inputMuted;
    }
    refreshTitles();
  }

  function showOk(context) {
    sendToStreamDock({ event: 'showOk', context: context });
  }

  function showAlert(context) {
    sendToStreamDock({ event: 'showAlert', context: context });
  }

  function runOperation(context, ticks) {
    var settings = contextSettings(context);
    connectObs(settings);
    if (settings.operation === 'switch_scene' && !settings.sceneName) {
      showAlert(context);
      return;
    }
    if ((settings.operation === 'toggle_mute' || settings.operation === 'volume' || settings.operation === 'set_volume') && !settings.sourceName) {
      showAlert(context);
      return;
    }
    if (settings.operation === 'meter' && !settings.sourceName) {
      showAlert(context);
      return;
    }
    if (settings.operation === 'toggle_visibility' && (!settings.sceneName || !(settings.sceneItemName || settings.sourceName))) {
      showAlert(context);
      return;
    }
    if (settings.operation === 'switch_scene_collection' && !settings.sceneCollectionName) {
      showAlert(context);
      return;
    }
    if (settings.operation === 'switch_profile' && !settings.profileName) {
      showAlert(context);
      return;
    }
    if (settings.operation === 'toggle_filter' && (!settings.sourceName || !settings.filterName)) {
      showAlert(context);
      return;
    }
    if (needsConfirmation(settings) && !confirmReady(context)) {
      setTitle(context, 'Press\nagain');
      return;
    }
    if (settings.operation === 'switch_scene' && settings.sceneName) {
      obsRequest('SetCurrentProgramScene', { sceneName: settings.sceneName }, function () { showOk(context); });
    } else if (settings.operation === 'toggle_record') {
      obsRequest('ToggleRecord', {}, function () { showOk(context); });
    } else if (settings.operation === 'start_record') {
      obsRequest('StartRecord', {}, function () { showOk(context); });
    } else if (settings.operation === 'stop_record') {
      obsRequest('StopRecord', {}, function () { showOk(context); });
    } else if (settings.operation === 'start_stream') {
      obsRequest('StartStream', {}, function () { showOk(context); });
    } else if (settings.operation === 'stop_stream') {
      obsRequest('StopStream', {}, function () { showOk(context); });
    } else if (settings.operation === 'toggle_mute' && settings.sourceName) {
      obsRequest('ToggleInputMute', { inputName: settings.sourceName }, function (data) {
        if (typeof data.inputMuted === 'boolean') {
          obsState.lastMute = data.inputMuted;
        }
        showOk(context);
        refreshTitles();
      });
    } else if (settings.operation === 'volume' && settings.sourceName) {
      var delta = (Number(ticks) || 1) * (Number(settings.volumeStepDb) || 1);
      obsRequest('GetInputVolume', { inputName: settings.sourceName }, function (data) {
        var current = Number(data.inputVolumeDb);
        if (!Number.isFinite(current)) {
          current = 0;
        }
        obsRequest('SetInputVolume', { inputName: settings.sourceName, inputVolumeDb: current + delta }, function () { showOk(context); });
      });
    } else if (settings.operation === 'set_volume' && settings.sourceName) {
      obsRequest('SetInputVolume', { inputName: settings.sourceName, inputVolumeDb: Number(settings.volumeSetDb) || 0 }, function () { showOk(context); });
    } else if (settings.operation === 'save_replay') {
      obsRequest('SaveReplayBuffer', {}, function () { showOk(context); });
    } else if (settings.operation === 'studio_transition') {
      var transitionPayload = settings.transitionName ? { transitionName: settings.transitionName } : {};
      obsRequest('TriggerStudioModeTransition', transitionPayload, function () { showOk(context); });
    } else if (settings.operation === 'toggle_virtual_camera') {
      obsRequest('ToggleVirtualCam', {}, function () { showOk(context); });
    } else if (settings.operation === 'toggle_studio_mode') {
      obsRequest('SetStudioModeEnabled', { studioModeEnabled: !obsState.studioMode }, function () { showOk(context); });
    } else if (settings.operation === 'switch_scene_collection') {
      obsRequest('SetCurrentSceneCollection', { sceneCollectionName: settings.sceneCollectionName }, function () { showOk(context); });
    } else if (settings.operation === 'switch_profile') {
      obsRequest('SetCurrentProfile', { profileName: settings.profileName }, function () { showOk(context); });
    } else if (settings.operation === 'toggle_visibility') {
      var itemName = settings.sceneItemName || settings.sourceName;
      obsRequest('GetSceneItemId', { sceneName: settings.sceneName, sourceName: itemName }, function (data) {
        obsRequest('GetSceneItemEnabled', { sceneName: settings.sceneName, sceneItemId: data.sceneItemId }, function (enabledData) {
          var nextEnabled = settings.visibilityMode === 'show' ? true : settings.visibilityMode === 'hide' ? false : !enabledData.sceneItemEnabled;
          obsRequest('SetSceneItemEnabled', {
            sceneName: settings.sceneName,
            sceneItemId: data.sceneItemId,
            sceneItemEnabled: nextEnabled
          }, function () { showOk(context); });
        });
      });
    } else if (settings.operation === 'toggle_filter') {
      obsRequest('SetSourceFilterEnabled', { sourceName: settings.sourceName, filterName: settings.filterName, filterEnabled: settings.filterEnabled !== false }, function () { showOk(context); });
    } else if (settings.operation === 'stats') {
      pollStats();
    } else if (settings.operation === 'meter') {
      obsRequest('GetInputVolume', { inputName: settings.sourceName }, function () { showOk(context); });
    } else {
      obsRequest('ToggleStream', {}, function () { showOk(context); });
    }
  }

  function needsConfirmation(settings) {
    return settings.confirmDangerous && /^(stop_stream|stop_record|switch_scene_collection|switch_profile)$/.test(settings.operation);
  }

  function confirmReady(context) {
    var now = Date.now();
    if (confirmUntil[context] && confirmUntil[context] > now) {
      confirmUntil[context] = 0;
      return true;
    }
    confirmUntil[context] = now + 3000;
    return false;
  }

  function rememberContext(message) {
    contexts[message.context] = {
      action: message.action,
      settings: message.payload && message.payload.settings || {}
    };
    connectObs(contextSettings(message.context));
    setTitle(message.context, titleFor(message.context));
  }

  function handleMessage(event) {
    var message = parseJson(event.data, {});
    if (message.event === 'willAppear') {
      rememberContext(message);
    } else if (message.event === 'willDisappear') {
      delete contexts[message.context];
    } else if (message.event === 'didReceiveSettings') {
      rememberContext(message);
    } else if (message.event === 'keyDown') {
      runOperation(message.context, 1);
    } else if (message.event === 'dialRotate') {
      var ticks = Number(message.payload && (message.payload.ticks || message.payload.delta || message.payload.rotation)) || 0;
      if (ticks !== 0) {
        runOperation(message.context, ticks);
      }
    }
  }

  window.connectElgatoStreamDeckSocket = function (port, uuid, registerEvent) {
    pluginUuid = uuid;
    streamDockSocket = new WebSocket('ws://127.0.0.1:' + port);
    streamDockSocket.onopen = function () {
      sendToStreamDock({ event: registerEvent, uuid: pluginUuid });
    };
    streamDockSocket.onmessage = handleMessage;
  };
}());
