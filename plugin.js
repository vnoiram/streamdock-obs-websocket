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
    filterEnabled: true
  };

  var streamDockSocket = null;
  var pluginUuid = null;
  var obsSocket = null;
  var identified = false;
  var reconnectTimer = null;
  var contexts = {};
  var pendingRequests = {};
  var requestId = 1;
  var obsState = { streaming: false, recording: false, levels: {}, currentScene: '', lastError: '', stats: {} };
  var confirmUntil = {};

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
    if (settings.operation === 'toggle_record') {
      return obsState.recording ? 'Record\non' : 'Record\noff';
    }
    if (settings.operation === 'stats') {
      return formatStats();
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
      return 'Studio\ntrans';
    }
    if (settings.operation === 'switch_scene_collection') {
      return 'Coll\n' + (settings.sceneCollectionName || 'unset');
    }
    if (settings.operation === 'switch_profile') {
      return 'Profile\n' + (settings.profileName || 'unset');
    }
    return obsState.streaming ? 'Stream\non' : 'Stream\noff';
  }

  function formatStats() {
    var stats = obsState.stats || {};
    var fps = stats.activeFps ? Math.round(stats.activeFps) + 'fps' : '';
    var cpu = stats.cpuUsage ? Math.round(stats.cpuUsage) + '% CPU' : '';
    var render = stats.renderTotalFrames ? String(stats.renderTotalFrames) + 'f' : '';
    return ['Stats', fps || cpu || render || 'waiting', cpu].filter(Boolean).join('\n');
  }

  function refreshTitles() {
    Object.keys(contexts).forEach(function (context) {
      setTitle(context, titleFor(context));
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
          obsState.streaming = !!data.outputActive;
          refreshTitles();
        });
        obsRequest('GetRecordStatus', {}, function (data) {
          obsState.recording = !!data.outputActive;
          refreshTitles();
        });
        obsRequest('GetCurrentProgramScene', {}, function (data) {
          obsState.currentScene = data.currentProgramSceneName || '';
          refreshTitles();
        });
        pollStats();
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
    obsRequest('GetStats', {}, function (data) {
      obsState.stats = data || {};
      refreshTitles();
    });
    setTimeout(pollStats, 5000);
  }

  function handleObsEvent(event) {
    if (event.eventType === 'StreamStateChanged') {
      obsState.streaming = !!(event.eventData && event.eventData.outputActive);
    }
    if (event.eventType === 'RecordStateChanged') {
      obsState.recording = !!(event.eventData && event.eventData.outputActive);
    }
    if (event.eventType === 'CurrentProgramSceneChanged') {
      obsState.currentScene = event.eventData && event.eventData.sceneName || '';
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
    if ((settings.operation === 'toggle_mute' || settings.operation === 'volume') && !settings.sourceName) {
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
      obsRequest('ToggleInputMute', { inputName: settings.sourceName }, function () { showOk(context); });
    } else if (settings.operation === 'volume' && settings.sourceName) {
      var delta = (Number(ticks) || 1) * (Number(settings.volumeStepDb) || 1);
      obsRequest('GetInputVolume', { inputName: settings.sourceName }, function (data) {
        var current = Number(data.inputVolumeDb);
        if (!Number.isFinite(current)) {
          current = 0;
        }
        obsRequest('SetInputVolume', { inputName: settings.sourceName, inputVolumeDb: current + delta }, function () { showOk(context); });
      });
    } else if (settings.operation === 'save_replay') {
      obsRequest('SaveReplayBuffer', {}, function () { showOk(context); });
    } else if (settings.operation === 'studio_transition') {
      obsRequest('TriggerStudioModeTransition', {}, function () { showOk(context); });
    } else if (settings.operation === 'switch_scene_collection') {
      obsRequest('SetCurrentSceneCollection', { sceneCollectionName: settings.sceneCollectionName }, function () { showOk(context); });
    } else if (settings.operation === 'switch_profile') {
      obsRequest('SetCurrentProfile', { profileName: settings.profileName }, function () { showOk(context); });
    } else if (settings.operation === 'toggle_visibility') {
      var itemName = settings.sceneItemName || settings.sourceName;
      obsRequest('GetSceneItemId', { sceneName: settings.sceneName, sourceName: itemName }, function (data) {
        obsRequest('GetSceneItemEnabled', { sceneName: settings.sceneName, sceneItemId: data.sceneItemId }, function (enabledData) {
          obsRequest('SetSceneItemEnabled', {
            sceneName: settings.sceneName,
            sceneItemId: data.sceneItemId,
            sceneItemEnabled: !enabledData.sceneItemEnabled
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
