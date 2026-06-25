(function () {
  'use strict';

  var websocket = null;
  var context = null;
  var settings = {
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
    'local.streamdock.obs.stats': 'stats'
  };
  var obsSocket = null;
  var obsRequestId = 1;
  var obsLists = { scenes: [], sources: [], sceneItems: [], collections: [], profiles: [], filters: [] };

  function byId(id) {
    return document.getElementById(id);
  }

  function update() {
    if (!websocket || websocket.readyState !== WebSocket.OPEN || !context) {
      return;
    }
    settings.endpoint = byId('endpoint').value.trim();
    settings.password = byId('password').value;
    settings.operation = byId('operation').value;
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
    websocket.send(JSON.stringify({ event: 'setSettings', context: context, payload: settings }));
  }

  function setStatus(text) {
    byId('status').textContent = text;
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
        if (auth && settings.password) {
          obsAuth(settings.password, auth.challenge, auth.salt).then(function (authentication) {
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

  function applySettings(next) {
    settings = Object.assign({}, settings, next || {});
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
    if (settings.endpoint) {
      setTimeout(refreshObsLists, 100);
    }
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
    var blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
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
      applySettings(JSON.parse(text));
      update();
    });
  }

  function copySettings() {
    update();
    navigator.clipboard.writeText(JSON.stringify(settings, null, 2)).then(function () {
      setStatus('settings copied');
    }).catch(function () {
      setStatus('copy failed');
    });
  }

  function pasteSettings() {
    navigator.clipboard.readText().then(function (text) {
      applySettings(JSON.parse(text));
      update();
      setStatus('settings pasted');
    }).catch(function () {
      setStatus('paste failed');
    });
  }

  window.connectElgatoStreamDeckSocket = function (port, uuid, registerEvent, info, actionInfo) {
    var parsedActionInfo = JSON.parse(actionInfo || '{}');
    context = parsedActionInfo.context || uuid;
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
    ['endpoint', 'password', 'operation', 'sceneName', 'sourceName', 'sceneItemName', 'volumeStepDb', 'sceneCollectionName', 'profileName', 'connectionPresetsJson', 'connectionPresetName', 'filterName'].forEach(function (id) {
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
    ['confirmDangerous', 'filterEnabled'].forEach(function (id) {
      byId(id).addEventListener('change', update);
    });
    byId('refreshObs').addEventListener('click', refreshObsLists);
    byId('copySettings').addEventListener('click', copySettings);
    byId('pasteSettings').addEventListener('click', pasteSettings);
    byId('exportSettings').addEventListener('click', exportSettings);
    byId('importSettings').addEventListener('change', importSettings);
  });
}());
