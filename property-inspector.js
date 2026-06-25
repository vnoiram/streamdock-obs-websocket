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
    profileName: ''
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
    'local.streamdock.obs.meter': 'meter'
  };
  var obsSocket = null;
  var obsRequestId = 1;

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

  function obsRequest(type) {
    obsSocket.send(JSON.stringify({
      op: 6,
      d: {
        requestType: type,
        requestId: String(obsRequestId++),
        requestData: {}
      }
    }));
  }

  function refreshObsLists() {
    if (obsSocket && (obsSocket.readyState === WebSocket.OPEN || obsSocket.readyState === WebSocket.CONNECTING)) {
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
        setStatus('requesting');
        obsRequest('GetSceneList');
        obsRequest('GetInputList');
        obsRequest('GetSceneCollectionList');
        obsRequest('GetProfileList');
      } else if (message.op === 7 && message.d && message.d.requestStatus && message.d.requestStatus.result) {
        if (message.d.requestType === 'GetSceneList') {
          renderList('sceneList', (message.d.responseData.scenes || []).map(function (scene) { return scene.sceneName; }));
        }
        if (message.d.requestType === 'GetInputList') {
          renderList('sourceList', (message.d.responseData.inputs || []).map(function (input) { return input.inputName; }));
        }
        if (message.d.requestType === 'GetSceneCollectionList') {
          renderList('collectionList', message.d.responseData.sceneCollections || []);
        }
        if (message.d.requestType === 'GetProfileList') {
          renderList('profileList', message.d.responseData.profiles || []);
        }
        setStatus('lists loaded');
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

  function applySettings(next) {
    settings = Object.assign({}, settings, next || {});
    Object.keys(settings).forEach(function (key) {
      if (byId(key)) {
        byId(key).value = settings[key];
      }
    });
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
    ['endpoint', 'password', 'operation', 'sceneName', 'sourceName', 'sceneItemName', 'volumeStepDb', 'sceneCollectionName', 'profileName'].forEach(function (id) {
      byId(id).addEventListener('input', update);
      byId(id).addEventListener('change', update);
    });
    byId('refreshObs').addEventListener('click', refreshObsLists);
    byId('exportSettings').addEventListener('click', exportSettings);
    byId('importSettings').addEventListener('change', importSettings);
  });
}());
