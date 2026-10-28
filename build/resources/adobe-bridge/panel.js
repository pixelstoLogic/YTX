(function () {
  'use strict';
  var host = window.__adobe_cep__;
  var appName = 'premiere';
  var config = null;
  var busy = false;
  var polling = false;
  var configRetry = null;
  var pollTimer = null;
  var connected = false;
  var lastError = '';

  function node(id) { return document.getElementById(id); }
  function setMessage(text, error) {
    lastError = error ? String(text || '') : '';
    node('message').textContent = text;
    node('message').style.color = error ? '#ff7b82' : '#858a92';
  }
  function setDetails(text) {
    var details = node('details');
    if (details) details.textContent = text || '';
  }
  function showConnection(info) {
    connected = !!(info && info.connected);
    node('dot').classList.toggle('online', connected);
    node('connection').classList.toggle('online', connected);
    node('connection').textContent = connected ? 'YTX is connected — ready to import to the timeline.' : 'Waiting for YTX Studio to start…';
    node('sendSelection').disabled = !connected || busy;
    node('reconnect').disabled = false;
    if (info) {
      setDetails([
        info.serverVersion ? 'YTX ' + info.serverVersion : '',
        info.project || '',
        typeof info.queued === 'number' ? info.queued + ' queued command(s)' : ''
      ].filter(Boolean).join(' · '));
    }
  }

  function request(path, body, timeoutMs) {
    if (!config) return Promise.reject(new Error('YTX bridge settings are unavailable. Start YTX Studio, then choose Reconnect.'));
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || 6000) : null;
    var options = {
      method: body ? 'POST' : 'GET',
      headers: { 'X-YTX-Token': config.token },
      cache: 'no-store'
    };
    if (controller) options.signal = controller.signal;
    if (body) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    return fetch('http://127.0.0.1:' + config.port + path, options).then(function (response) {
      if (timer) clearTimeout(timer);
      if (response.status === 401) {
        config = null;
        throw new Error('The YTX security token changed. Restart the YTX Bridge panel or press Reconnect.');
      }
      if (!response.ok) throw new Error('YTX bridge returned HTTP ' + response.status + '.');
      return response.json();
    }, function (error) {
      if (timer) clearTimeout(timer);
      throw error.name === 'AbortError' ? new Error('YTX did not answer in time. Keep YTX Studio running and press Reconnect.') : error;
    });
  }

  function evalHost(code, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!host || typeof host.evalScript !== 'function') return reject(new Error('Adobe CEP scripting is unavailable. Restart the Adobe host.'));
      var finished = false;
      var timer = setTimeout(function () {
        if (!finished) { finished = true; reject(new Error('Adobe did not answer the ExtendScript request in time.')); }
      }, timeoutMs || 12000);
      try {
        host.evalScript(code, function (result) {
          if (finished) return;
          finished = true; clearTimeout(timer);
          if (result === 'EvalScript error.') reject(new Error('Adobe ExtendScript failed. Make sure the active project/timeline is editable.'));
          else resolve(result);
        });
      } catch (error) {
        finished = true; clearTimeout(timer);
        reject(error);
      }
    });
  }

  function readConfigFile() {
    if (!window.cep || !window.cep.fs || typeof window.cep.fs.readFile !== 'function') {
      throw new Error('Adobe CEP file access is unavailable. Restart the Adobe host and reopen YTX Bridge.');
    }
    var candidates = [];
    try {
      var extensionRoot = host.getSystemPath('extension');
      if (extensionRoot) candidates.push(extensionRoot.replace(/\\/g, '/') + '/bridge.json');
    } catch (_) {}
    try {
      var userData = host.getSystemPath('userData');
      if (userData) {
        var root = userData.replace(/\\/g, '/');
        candidates.push(root + '/YTX/bridge.json', root + '/Adobe/YTX/bridge.json');
      }
    } catch (_) {}
    try {
      var appData = host.getSystemPath('appData');
      if (appData) candidates.push(appData.replace(/\\/g, '/') + '/YTX/bridge.json');
    } catch (_) {}
    for (var index = 0; index < candidates.length; index++) {
      try {
        var result = window.cep.fs.readFile(candidates[index]);
        if (result && !result.err && result.data) {
          var parsed = JSON.parse(result.data);
          if (parsed && parsed.port && parsed.token) return parsed;
        }
      } catch (_) {}
    }
    return null;
  }

  function scheduleConfigRetry() {
    if (!configRetry) configRetry = window.setInterval(loadConfig, 4000);
  }

  function loadConfig() {
    try {
      var next = readConfigFile();
      if (!next) throw new Error('Start YTX Studio once to finish bridge setup, then press Reconnect.');
      config = next;
      if (configRetry) { window.clearInterval(configRetry); configRetry = null; }
      setMessage('Connecting to YTX Studio…');
      poll();
      startPolling();
      return true;
    } catch (error) {
      setMessage(error.message, true);
      scheduleConfigRetry();
      return false;
    }
  }

  function pollCommand() {
    if (!config) return;
    evalHost('ytxGetProjectFolder()', 5000).catch(function () { return ''; })
      .then(function (projectPath) {
        return request('/bridge/heartbeat', {
          app: appName,
          host: node('hostName').textContent,
          project: projectPath ? String(projectPath).split(/[\\/]/).pop() : 'Unsaved project',
          projectPath: projectPath || '',
          panelVersion: '2.0.0',
          capabilities: ['import-to-timeline', 'handoff', 'project-media']
        });
      })
      .then(function (info) { showConnection(info); return request('/bridge/next?app=' + appName); })
      .then(function (command) {
        if (!command || !command.id) return;
        busy = true;
        node('sendSelection').disabled = true;
        setMessage('Importing the selected range into the active ' + (appName === 'premiere' ? 'timeline' : 'composition') + '…');
        var safePath = JSON.stringify(String(command.path)).replace(/\\/g, '\\\\');
        return evalHost('ytxImportToTimeline(' + safePath + ')', 30000).then(function (result) {
          var text = String(result || '');
          if (text.indexOf('OK|') === 0) {
            setMessage(text.slice(3));
            return request('/bridge/complete', { app: appName, id: command.id, ok: true, message: text.slice(3), progress: 100 });
          }
          throw new Error(text || 'Adobe import failed.');
        }).catch(function (error) {
          setMessage(error.message, true);
          return request('/bridge/complete', { app: appName, id: command.id, ok: false, message: error.message, progress: 100 });
        }).finally(function () {
          busy = false;
          node('sendSelection').disabled = !connected;
        });
      })
      .catch(function (error) {
        setMessage(error.message, true);
        showConnection({ connected: false });
        if (!config) scheduleConfigRetry();
      });
  }

  function poll() {
    if (polling || !config) return;
    polling = true;
    Promise.resolve(pollCommand()).finally(function () { polling = false; });
  }

  function startPolling() {
    if (!pollTimer) pollTimer = window.setInterval(poll, 2000);
  }

  function readHostName() {
    try {
      var environment = JSON.parse(host.getHostEnvironment());
      appName = environment.appId === 'PPRO' ? 'premiere' : 'aftereffects';
      node('hostName').textContent = appName === 'premiere' ? 'Adobe Premiere Pro' : 'Adobe After Effects';
    } catch (error) {
      setMessage('Could not read the Adobe host environment. Restart the Adobe app.', true);
    }
  }

  node('reconnect').addEventListener('click', function () {
    config = null;
    setMessage('Reconnecting to YTX Studio…');
    if (loadConfig()) poll();
  });

  node('sendSelection').addEventListener('click', function () {
    if (busy || !config) return;
    busy = true;
    node('sendSelection').disabled = true;
    setMessage('Reading selected media…');
    evalHost('ytxGetSelectedMediaPath()').then(function (filePath) {
      var text = String(filePath || '');
      if (!text || text.indexOf('ERR|') === 0) throw new Error(text.replace('ERR|', '') || 'Select a media clip first.');
      return request('/bridge/handoff', { app: appName, path: text });
    }).then(function (result) {
      if (result.error) throw new Error(result.error);
      setMessage('Selected media sent to YTX Studio.');
    }).catch(function (error) {
      setMessage(error.message, true);
    }).finally(function () {
      busy = false;
      node('sendSelection').disabled = !connected;
    });
  });

  readHostName();
  loadConfig();
  window.addEventListener('error', function (event) { setMessage(event.message || 'Unexpected YTX Bridge error.', true); });
}());
