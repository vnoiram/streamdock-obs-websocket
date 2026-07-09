(function () {
  'use strict';

  var websocket = null;
  var context = null;
  var currentAction = '';
  var settings = {
    endpoint: 'ws://127.0.0.1:4455',
    password: '',
    savePassword: false,
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
    'local.streamdock.obs.studiomode': 'toggle_studio_mode'
  };
  var obsSocket = null;
  var obsRequestId = 1;
  var obsLists = { scenes: [], sources: [], sceneItems: [], collections: [], profiles: [], filters: [] };
  var SETTING_KEYS = [
    'endpoint', 'password', 'savePassword', 'operation', 'sceneName', 'sourceName', 'sceneItemName',
    'volumeStepDb', 'sceneCollectionName', 'profileName', 'connectionPresetsJson',
    'connectionPresetName', 'confirmDangerous', 'filterName', 'filterEnabled',
    'visibilityMode', 'volumeSetDb', 'transitionName'
  ];
  var COMMON_FIELDS = ['endpoint', 'password', 'savePassword', 'connectionPresetsJson', 'connectionPresetName', 'refreshObs', 'repairNames', 'preflightCheck', 'diagnoseSettings', 'resetSettings', 'copySettings', 'pasteSettings', 'exportSettings', 'copyDiagnostics', 'importSettings'];
  var OPERATION_FIELDS = {
    toggle_stream: [],
    toggle_record: [],
    switch_scene: ['sceneName'],
    toggle_mute: ['sourceName'],
    volume: ['sourceName', 'volumeStepDb'],
    set_volume: ['sourceName', 'volumeSetDb'],
    save_replay: [],
    toggle_visibility: ['sceneName', 'sourceName', 'sceneItemName', 'visibilityMode'],
    studio_transition: ['transitionName'],
    switch_scene_collection: ['sceneCollectionName', 'confirmDangerous'],
    switch_profile: ['profileName', 'confirmDangerous'],
    meter: ['sourceName'],
    toggle_filter: ['sourceName', 'filterName', 'filterEnabled'],
    stats: [],
    toggle_virtual_camera: [],
    toggle_studio_mode: []
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function update() {
    if (!websocket || websocket.readyState !== WebSocket.OPEN || !context) {
      return;
    }
    settings.endpoint = byId('endpoint').value.trim();
    settings.savePassword = byId('savePassword').checked;
    settings.password = settings.savePassword ? byId('password').value : '';
    settings.operation = fixedOperation();
    byId('operation').value = settings.operation;
    settings.sceneName = byId('sceneName').value.trim();
    settings.sourceName = byId('sourceName').value.trim();
    settings.sceneItemName = byId('sceneItemName').value.trim();
    settings.volumeStepDb = Number(byId('volumeStepDb').value) || 1;
    settings.sceneCollectionName = byId('sceneCollectionName').value.trim();
    settings.profileName = byId('profileName').value.trim();
    settings.connectionPresetsJson = byId('connectionPresetsJson').value.trim();
    settings.connectionPresetName = byId('connectionPresetName').value.trim();
    settings.confirmDangerous = byId('confirmDangerous').checked;
    settings.filterName = byId('filterName').value.trim();
    settings.filterEnabled = byId('filterEnabled').checked;
    settings.visibilityMode = byId('visibilityMode').value;
    settings.volumeSetDb = byId('volumeSetDb').value;
    settings.transitionName = byId('transitionName').value.trim();
    websocket.send(JSON.stringify({ event: 'setSettings', context: context, payload: settings }));
    renderEndpointStatus();
    applyVisibility();
  }

  function setStatus(text) {
    byId('status').textContent = text;
    appendDiagnostics(text);
  }

  function rowFor(id) {
    var element = byId(id);
    while (element && element !== document.body) {
      if (element.classList && element.classList.contains('sdpi-item')) return element;
      element = element.parentNode;
    }
    return null;
  }

  function setFieldVisible(id, visible) {
    var row = rowFor(id);
    if (row) row.classList.toggle('is-hidden', !visible);
  }

  function fixedOperation() {
    return ACTION_OPERATIONS[currentAction] || settings.operation || 'toggle_stream';
  }

  function applyVisibility() {
    var operation = fixedOperation();
    var visible = {};
    COMMON_FIELDS.concat(OPERATION_FIELDS[operation] || []).forEach(function (id) {
      visible[id] = true;
    });
    SETTING_KEYS.concat(['refreshObs', 'repairNames', 'preflightCheck', 'diagnoseSettings', 'resetSettings', 'copySettings', 'pasteSettings', 'exportSettings', 'copyDiagnostics', 'importSettings']).forEach(function (id) {
      setFieldVisible(id, !!visible[id]);
    });
    setFieldVisible('operation', false);
  }

  function renderEndpointStatus() {
    var status = byId('endpointStatus');
    if (!status) return;
    var endpoint = byId('endpoint').value.trim();
    var password = byId('password').value || settings.password;
    if (!endpoint) {
      status.textContent = 'missing OBS endpoint';
      return;
    }
    if (!/^wss?:\/\//i.test(endpoint)) {
      status.textContent = 'invalid WebSocket endpoint';
      return;
    }
    if (isLoopbackEndpoint(endpoint)) {
      status.textContent = password ? 'local OBS with password' : 'local OBS';
      return;
    }
    status.textContent = password ? 'remote OBS: restrict firewall' : 'remote OBS without password';
  }

  function isLoopbackEndpoint(endpoint) {
    try {
      var url = new URL(endpoint);
      return ['localhost', '127.0.0.1', '::1', '[::1]'].indexOf(url.hostname) !== -1;
    } catch (error) {
      return false;
    }
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

  function obsRequest(type, data) {
    obsSocket.send(JSON.stringify({
      op: 6,
      d: {
        requestType: type,
        requestId: String(obsRequestId++),
        requestData: data || {}
      }
    }));
  }

  function requestObsLists() {
    setStatus('requesting');
    obsRequest('GetSceneList');
    obsRequest('GetInputList');
    obsRequest('GetSceneCollectionList');
    obsRequest('GetProfileList');
    if (settings.sceneName) {
      obsRequest('GetSceneItemList', { sceneName: settings.sceneName });
    }
    if (settings.sourceName) {
      obsRequest('GetSourceFilterList', { sourceName: settings.sourceName });
    }
  }

  function refreshObsLists() {
    if (obsSocket && obsSocket.readyState === WebSocket.OPEN) {
      requestObsLists();
      return;
    }
    if (obsSocket && obsSocket.readyState === WebSocket.CONNECTING) {
      return;
    }
    setStatus('connecting');
    obsSocket = new WebSocket(settings.endpoint || 'ws://127.0.0.1:4455');
    obsSocket.onmessage = function (event) {
      var message = JSON.parse(event.data);
      if (message.op === 0) {
        var payload = { rpcVersion: 1 };
        var auth = message.d && message.d.authentication;
        var identify = function () {
          obsSocket.send(JSON.stringify({ op: 1, d: payload }));
        };
        var password = byId('password').value || settings.password;
        if (auth && password) {
          obsAuth(password, auth.challenge, auth.salt).then(function (authentication) {
            payload.authentication = authentication;
            identify();
          });
        } else {
          identify();
        }
      } else if (message.op === 2) {
        requestObsLists();
      } else if (message.op === 7 && message.d && message.d.requestStatus && message.d.requestStatus.result) {
        if (message.d.requestType === 'GetSceneList') {
          obsLists.scenes = (message.d.responseData.scenes || []).map(function (scene) { return scene.sceneName; });
          renderList('sceneList', obsLists.scenes);
        }
        if (message.d.requestType === 'GetInputList') {
          obsLists.sources = (message.d.responseData.inputs || []).map(function (input) { return input.inputName; });
          renderList('sourceList', obsLists.sources);
        }
        if (message.d.requestType === 'GetSceneItemList') {
          obsLists.sceneItems = (message.d.responseData.sceneItems || []).map(function (item) {
            return item.sourceName || item.sceneItemName || '';
          }).filter(Boolean);
          renderList('sceneItemList', obsLists.sceneItems);
        }
        if (message.d.requestType === 'GetSceneCollectionList') {
          obsLists.collections = message.d.responseData.sceneCollections || [];
          renderList('collectionList', obsLists.collections);
        }
        if (message.d.requestType === 'GetProfileList') {
          obsLists.profiles = message.d.responseData.profiles || [];
          renderList('profileList', obsLists.profiles);
        }
        if (message.d.requestType === 'GetSourceFilterList') {
          obsLists.filters = (message.d.responseData.filters || []).map(function (filter) { return filter.filterName; });
          renderList('filterList', obsLists.filters);
        }
        validateSelections();
      } else if (message.op === 7) {
        setStatus('OBS request failed');
      }
    };
    obsSocket.onerror = function () {
      setStatus('OBS offline');
    };
    obsSocket.onclose = function () {
      obsSocket = null;
    };
  }

  function renderList(id, values) {
    var list = byId(id);
    list.innerHTML = '';
    values.sort().forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      list.appendChild(option);
    });
  }

  function warnIfMissing(warnings, label, value, values) {
    if (value && values.length && values.indexOf(value) === -1) {
      warnings.push(label + ' missing');
    }
  }

  function validateSelections() {
    var warnings = [];
    warnIfMissing(warnings, 'scene', settings.sceneName, obsLists.scenes);
    warnIfMissing(warnings, 'source', settings.sourceName, obsLists.sources);
    warnIfMissing(warnings, 'item', settings.sceneItemName, obsLists.sceneItems.length ? obsLists.sceneItems : obsLists.sources);
    warnIfMissing(warnings, 'collection', settings.sceneCollectionName, obsLists.collections);
    warnIfMissing(warnings, 'profile', settings.profileName, obsLists.profiles);
    warnIfMissing(warnings, 'filter', settings.filterName, obsLists.filters);
    setStatus(warnings.length ? warnings.join(', ') : 'lists loaded');
  }

  function repairNames() {
    var changed = [];
    changed = changed.concat(repairField('sceneName', obsLists.scenes));
    changed = changed.concat(repairField('sourceName', obsLists.sources));
    changed = changed.concat(repairField('sceneItemName', obsLists.sceneItems.length ? obsLists.sceneItems : obsLists.sources));
    changed = changed.concat(repairField('sceneCollectionName', obsLists.collections));
    changed = changed.concat(repairField('profileName', obsLists.profiles));
    changed = changed.concat(repairField('filterName', obsLists.filters));
    if (changed.length) {
      update();
      setStatus('repaired ' + changed.join(', '));
    } else {
      setStatus('no repair candidates');
    }
  }

  function repairField(id, values) {
    var current = byId(id).value.trim();
    if (!current || !values || values.indexOf(current) !== -1) {
      return [];
    }
    var best = closest(current, values);
    if (best) {
      byId(id).value = best;
      return [id];
    }
    return [];
  }

  function closest(value, values) {
    var best = '';
    var bestScore = Infinity;
    values.forEach(function (candidate) {
      var score = distance(String(value).toLowerCase(), String(candidate).toLowerCase());
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    });
    return bestScore <= Math.max(3, Math.ceil(String(value).length / 3)) ? best : '';
  }

  function distance(a, b) {
    var dp = [];
    for (var i = 0; i <= a.length; i += 1) dp[i] = [i];
    for (var j = 1; j <= b.length; j += 1) dp[0][j] = j;
    for (var x = 1; x <= a.length; x += 1) {
      for (var y = 1; y <= b.length; y += 1) {
        dp[x][y] = Math.min(dp[x - 1][y] + 1, dp[x][y - 1] + 1, dp[x - 1][y - 1] + (a[x - 1] === b[y - 1] ? 0 : 1));
      }
    }
    return dp[a.length][b.length];
  }

  function preflightCheck() {
    var checks = [];
    checks.push(isLoopbackEndpoint(byId('endpoint').value) || byId('password').value ? 'endpoint ok' : 'remote no password');
    checks.push(obsLists.scenes.length ? 'scenes ok' : 'refresh scenes');
    checks.push(obsLists.sources.length ? 'sources ok' : 'refresh sources');
    if (byId('sceneName').value && obsLists.scenes.indexOf(byId('sceneName').value) === -1) checks.push('scene missing');
    if (byId('sourceName').value && obsLists.sources.indexOf(byId('sourceName').value) === -1) checks.push('source missing');
    setStatus(checks.join(', '));
  }

  function diagnoseSettings() {
    var issues = [];
    if (!byId('endpoint').value.trim()) issues.push('missing endpoint');
    if (!/^wss?:\/\//i.test(byId('endpoint').value.trim())) issues.push('invalid endpoint');
    if (!isLoopbackEndpoint(byId('endpoint').value.trim()) && !byId('password').value && !settings.password) issues.push('remote no password');
    try {
      connectionPresets();
    } catch (error) {
      issues.push('invalid presets');
    }
    setStatus(issues.join(', ') || 'diagnostics ok');
  }

  function resetSettings() {
    applySettings({ endpoint: 'ws://127.0.0.1:4455', password: '', savePassword: false, operation: 'toggle_stream', sceneName: '', sourceName: '', sceneItemName: '', volumeStepDb: 1, sceneCollectionName: '', profileName: '', connectionPresetsJson: '', connectionPresetName: '', confirmDangerous: false, filterName: '', filterEnabled: true, visibilityMode: 'toggle', volumeSetDb: '', transitionName: '' });
    update();
    setStatus('settings reset');
  }

  function applySettings(next) {
    settings = mergeKnownSettings(copyKnownSettings(settings), next || {});
    settings.operation = fixedOperation();
    Object.keys(settings).forEach(function (key) {
      if (byId(key)) {
        if (byId(key).type === 'checkbox') {
          byId(key).checked = settings[key] === true || settings[key] === 'true';
        } else {
          byId(key).value = settings[key];
        }
      }
    });
    renderConnectionPresetNames();
    if (settings.password && settings.savePassword !== true && settings.savePassword !== 'true') {
      settings.savePassword = true;
      byId('savePassword').checked = true;
    }
    if (settings.endpoint) {
      setTimeout(refreshObsLists, 100);
    }
    renderEndpointStatus();
    applyVisibility();
  }

  function copyKnownSettings(source) {
    var out = {};
    return mergeKnownSettings(out, source || {});
  }

  function mergeKnownSettings(target, source) {
    SETTING_KEYS.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        target[key] = source[key];
      }
    });
    return target;
  }

  function connectionPresets() {
    if (!settings.connectionPresetsJson) {
      return {};
    }
    var parsed = JSON.parse(settings.connectionPresetsJson);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  }

  function renderConnectionPresetNames() {
    var list = byId('connectionPresetNames');
    if (!list) return;
    list.innerHTML = '';
    try {
      Object.keys(connectionPresets()).forEach(function (name) {
        var option = document.createElement('option');
        option.value = name;
        list.appendChild(option);
      });
    } catch (error) {
      setStatus('invalid connection presets');
    }
  }

  function exportSettings() {
    update();
    var blob = new Blob([JSON.stringify(backupPayload(), null, 2)], { type: 'application/json' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'streamdock-obs-settings.json';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function importSettings(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    file.text().then(function (text) {
      applySettings(settingsFromImport(JSON.parse(text)));
      update();
    });
  }

  function copySettings() {
    update();
    navigator.clipboard.writeText(JSON.stringify(backupPayload(), null, 2)).then(function () {
      setStatus('settings copied');
    }).catch(function () {
      setStatus('copy failed');
    });
  }

  function sanitizedSettings(source) {
    var copy = Object.assign({}, source || {});
    copy.password = '';
    copy.savePassword = false;
    if (copy.connectionPresetsJson) {
      try {
        var presets = JSON.parse(copy.connectionPresetsJson);
        Object.keys(presets || {}).forEach(function (name) {
          if (presets[name] && typeof presets[name] === 'object') {
            presets[name].password = '';
            presets[name].savePassword = false;
          }
        });
        copy.connectionPresetsJson = JSON.stringify(presets, null, 2);
      } catch (error) {
        copy.connectionPresetsJson = '';
      }
    }
    return copy;
  }

  function backupPayload() {
    return {
      type: 'streamdock-plugin-backup',
      plugin: 'streamdock-obs-websocket',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: sanitizedSettings(settings)
    };
  }

  function settingsFromImport(imported) {
    if (imported && imported.type === 'streamdock-plugin-backup') {
      return imported.settings || {};
    }
    return imported || {};
  }

  function diagnosticsKey() {
    return 'streamdock-obs-websocket:diagnostics';
  }

  function diagnosticsLog() {
    try {
      return JSON.parse(localStorage.getItem(diagnosticsKey()) || '[]');
    } catch (error) {
      return [];
    }
  }

  function appendDiagnostics(text) {
    try {
      var items = diagnosticsLog();
      items.unshift({ time: new Date().toISOString(), message: String(text || '') });
      localStorage.setItem(diagnosticsKey(), JSON.stringify(items.slice(0, 50)));
    } catch (error) {
      // localStorage can be disabled in some plugin runtimes.
    }
  }

  function copyDiagnostics() {
    navigator.clipboard.writeText(JSON.stringify(diagnosticsLog(), null, 2)).then(function () {
      setStatus('diagnostics copied');
    }).catch(function () {
      setStatus('diagnostics copy failed');
    });
  }

  function pasteSettings() {
    navigator.clipboard.readText().then(function (text) {
      applySettings(settingsFromImport(JSON.parse(text)));
      update();
      setStatus('settings pasted');
    }).catch(function () {
      setStatus('paste failed');
    });
  }

  window.connectElgatoStreamDeckSocket = function (port, uuid, registerEvent, info, actionInfo) {
    var parsedActionInfo = JSON.parse(actionInfo || '{}');
    context = parsedActionInfo.context || uuid;
    currentAction = parsedActionInfo.action || '';
    if (ACTION_OPERATIONS[parsedActionInfo.action]) {
      settings.operation = ACTION_OPERATIONS[parsedActionInfo.action];
      if (byId('operation')) {
        byId('operation').value = settings.operation;
      }
    }
    websocket = new WebSocket('ws://127.0.0.1:' + port);
    websocket.onopen = function () {
      websocket.send(JSON.stringify({ event: registerEvent, uuid: uuid }));
      websocket.send(JSON.stringify({ event: 'getSettings', context: context }));
    };
    websocket.onmessage = function (event) {
      var message = JSON.parse(event.data);
      if (message.event === 'didReceiveSettings') {
        applySettings(message.payload && message.payload.settings);
      }
    };
  };

  window.addEventListener('DOMContentLoaded', function () {
    ['endpoint', 'password', 'operation', 'sceneName', 'sourceName', 'sceneItemName', 'volumeStepDb', 'volumeSetDb', 'visibilityMode', 'sceneCollectionName', 'profileName', 'connectionPresetsJson', 'connectionPresetName', 'filterName', 'transitionName'].forEach(function (id) {
      byId(id).addEventListener('input', update);
      byId(id).addEventListener('change', update);
    });
    byId('sourceName').addEventListener('change', function () {
      obsLists.filters = [];
      renderList('filterList', []);
      refreshObsLists();
    });
    byId('sceneName').addEventListener('change', function () {
      obsLists.sceneItems = [];
      renderList('sceneItemList', []);
      refreshObsLists();
    });
    ['confirmDangerous', 'filterEnabled', 'savePassword'].forEach(function (id) {
      byId(id).addEventListener('change', update);
    });
    byId('refreshObs').addEventListener('click', refreshObsLists);
    byId('repairNames').addEventListener('click', repairNames);
    byId('preflightCheck').addEventListener('click', preflightCheck);
    byId('diagnoseSettings').addEventListener('click', diagnoseSettings);
    byId('resetSettings').addEventListener('click', resetSettings);
    byId('copySettings').addEventListener('click', copySettings);
    byId('pasteSettings').addEventListener('click', pasteSettings);
    byId('exportSettings').addEventListener('click', exportSettings);
    byId('copyDiagnostics').addEventListener('click', copyDiagnostics);
    byId('importSettings').addEventListener('change', importSettings);
    renderEndpointStatus();
    applyVisibility();
  });
}());
