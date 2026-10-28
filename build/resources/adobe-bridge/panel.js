(function () {
  'use strict';
  var host = window.__adobe_cep__;
  var appName = 'premiere';
  var config = null;
  var busy = false;
  function setMessage(text, error) {
    var node = document.getElementById('message');
    node.textContent = text;
    node.style.color = error ? '#ff7b82' : '#858a92';
  }
  function req(path, body) {
    if (!config) return Promise.reject(new Error('YTX bridge settings are unavailable.'));
    var options = { method: body ? 'POST' : 'GET', headers: { 'X-YTX-Token': config.token } };
    if (body) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    return fetch('http://127.0.0.1:' + config.port + path, options).then(function (r) { return r.json(); });
  }
  function evalHost(code) {
    return new Promise(function (resolve, reject) {
      host.evalScript(code, function (result) {
        if (result === 'EvalScript error.') reject(new Error(result)); else resolve(result);
      });
    });
  }
  function updateConnection(info) {
    var connected = !!info.connected;
    document.getElementById('dot').classList.toggle('online', connected);
    document.getElementById('connection').classList.toggle('online', connected);
    document.getElementById('connection').textContent = connected ? 'YTX is connected — ready to import to the timeline.' : 'Waiting for YTX Studio to start…';
    document.getElementById('sendSelection').disabled = !connected || busy;
  }
  function pollCommand() {
    if (!config) return;
    evalHost('ytxGetProjectFolder()').catch(function () { return ''; })
      .then(function (projectPath) { return req('/bridge/heartbeat', { app: appName, host: document.getElementById('hostName').textContent, project: projectPath ? projectPath.split(/[\\/]/).pop() : 'Unsaved project', projectPath: projectPath || '' }); })
      .then(updateConnection)
      .then(function () { return req('/bridge/next?app=' + appName); })
      .then(function (command) {
        if (!command || !command.id) return;
        busy = true; document.getElementById('sendSelection').disabled = true;
        setMessage('Importing selected range…');
        var safePath = JSON.stringify(command.path).replace(/\\/g, '\\\\');
        return evalHost('ytxImportToTimeline(' + safePath + ')').then(function (result) {
          if (String(result).indexOf('OK|') === 0) {
            setMessage(String(result).slice(3));
            return req('/bridge/complete', { app: appName, id: command.id, ok: true, message: String(result).slice(3), progress: 100 });
          }
          throw new Error(String(result || 'Adobe import failed.'));
        }).catch(function (err) {
          setMessage(err.message, true);
          return req('/bridge/complete', { app: appName, id: command.id, ok: false, message: err.message, progress: 100 });
        }).finally(function () { busy = false; });
      }).catch(function (err) { setMessage(err.message, true); });
  }
  function readSettings() {
    try {
      if (!host || typeof host.getSystemPath !== 'function') throw new Error('Adobe CEP host APIs are unavailable. Restart Premiere Pro or After Effects and reopen YTX Bridge.');
      var root = host.getSystemPath('userData');
      if (!root) throw new Error('Adobe could not resolve its user data folder. Restart the Adobe host and retry.');
      root = root.replace(/\\/g, '/');
      var candidates = [root + '/YTX/bridge.json', root + '/Adobe/YTX/bridge.json'];
      var result = null;
      for (var i = 0; i < candidates.length; i++) {
        var candidate = window.cep.fs.readFile(candidates[i]);
        if (candidate && !candidate.err && candidate.data) { result = candidate; break; }
      }
      if (!result || result.err || !result.data) throw new Error('Start YTX Studio once to finish bridge setup.');
      config = JSON.parse(result.data);
      pollCommand();
      window.setInterval(pollCommand, 2000);
    } catch (err) { setMessage(err.message, true); }
  }
  try {
    var environment = JSON.parse(host.getHostEnvironment());
    appName = environment.appId === 'PPRO' ? 'premiere' : 'aftereffects';
    document.getElementById('hostName').textContent = appName === 'premiere' ? 'Adobe Premiere Pro' : 'Adobe After Effects';
  } catch (_) {}
  document.getElementById('sendSelection').addEventListener('click', function () {
    if (busy || !config) return;
    busy = true; document.getElementById('sendSelection').disabled = true; setMessage('Reading selected media…');
    evalHost('ytxGetSelectedMediaPath()').then(function (filePath) {
      if (!filePath || String(filePath).indexOf('ERR|') === 0) throw new Error(String(filePath || 'Select a media clip first.').replace('ERR|', ''));
      return req('/bridge/handoff', { app: appName, path: filePath });
    }).then(function (result) { if (result.error) throw new Error(result.error); setMessage('Selected media sent to YTX Studio.'); })
      .catch(function (err) { setMessage(err.message, true); })
      .finally(function () { busy = false; document.getElementById('sendSelection').disabled = false; });
  });
  readSettings();
}());

