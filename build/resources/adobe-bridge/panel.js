(function () {
  'use strict';
  var host = window.__adobe_cep__;
  var appName = 'premiere';
  var config = null;
  var busy = false;
  var polling = false;
  var pollCount = 0;
  var configRetry = null;
  var pollTimer = null;
  var connected = false;
  var wasConnected = false;
  var project = { name: '', folder: '', file: '' };
  var appMark = 'Pr';
  var mediaItems = [];
  var mediaLoadedFor = '';
  var mediaLoadedAt = 0;
  var lastInfo = null;

  function node(id) { return document.getElementById(id); }
  function setMessage(text, error) {
    node('message').textContent = text;
    node('message').style.color = error ? '#ff7b82' : '#858a92';
  }
  function setDetails(text) {
    var details = node('details');
    if (details) details.textContent = text || '';
  }
  function updateDetails(info) {
    if (info) lastInfo = info;
    var parts = [];
    if (lastInfo && lastInfo.serverVersion) parts.push('YTX ' + lastInfo.serverVersion);
    if (project.name) parts.push(project.name + (project.folder ? ' · linked to the project folder' : ' · save to link media'));
    else parts.push('Save this project to link YTX media');
    if (lastInfo && typeof lastInfo.queued === 'number' && lastInfo.queued > 0) parts.push(lastInfo.queued + ' queued command(s)');
    setDetails(parts.join(' · '));
  }
  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value >= 1073741824) return (value / 1073741824).toFixed(2) + ' GB';
    if (value >= 1048576) return (value / 1048576).toFixed(1) + ' MB';
    if (value >= 1024) return Math.round(value / 1024) + ' KB';
    return value + ' B';
  }
  function fileLabel(name) {
    var extension = String(name || '').split('.').pop().toUpperCase();
    return extension.length > 3 ? extension.slice(0, 3) : extension || 'MED';
  }
  function renderProject() {
    var saved = Boolean(project.name || project.folder);
    node('projectName').textContent = project.name || 'No saved project';
    node('projectMark').textContent = saved ? (project.name || 'P').charAt(0).toUpperCase() : appMark;
    node('projectPath').textContent = project.folder || 'Save this project to link YTX media to its folder.';
    node('projectPath').title = project.file || project.folder || '';
    updateDetails();
  }
  function updateMediaButtons() {
    var buttons = document.querySelectorAll('.media-insert');
    for (var index = 0; index < buttons.length; index++) {
      buttons[index].disabled = busy || !connected || !project.folder;
    }
  }
  function showConnection(info) {
    connected = !!(info && info.connected);
    node('dot').classList.toggle('online', connected);
    node('connection').classList.toggle('online', connected);
    node('connection').textContent = connected
      ? 'YTX is connected — assets import into the project and its timeline.'
      : 'Waiting for YTX Studio to start…';
    node('sendSelection').disabled = !connected || busy;
    node('reconnect').disabled = false;
    if (connected && !wasConnected) setMessage('Connected. Project media stays linked to this project.');
    if (!connected && wasConnected) setMessage('The YTX connection ended. Start YTX Studio, then press Reconnect.', true);
    wasConnected = connected;
    updateDetails(info);
    updateMediaButtons();
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
        scheduleConfigRetry();
        throw new Error('YTX restarted and issued a new security token. Reconnecting…');
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

  // CEP returns system paths as URI-encoded file URLs. cep.fs.readFile wants a
  // native path, so convert file:///C:/Users/Name/... back to C:\Users\Name\...
  function nativePath(value) {
    var text = String(value || '');
    if (!text) return '';
    if (/^file:/i.test(text)) {
      var raw = text.replace(/^file:\/*/i, '');
      try { raw = decodeURIComponent(raw); } catch (_) {}
      if (/^\/[A-Za-z]:/.test(raw)) raw = raw.slice(1);
      if (/^[A-Za-z]:/.test(raw)) return raw.replace(/\//g, '\\');
      return '\\\\' + raw.replace(/^\/+/, '').replace(/\//g, '\\');
    }
    try { text = decodeURIComponent(text); } catch (_) {}
    return text.replace(/\//g, '\\');
  }

  function configCandidates() {
    var candidates = [];
    function add(folder) {
      var root = nativePath(folder);
      if (!root) return;
      var file = root.replace(/[\\/]+$/, '') + '\\bridge.json';
      if (candidates.indexOf(file) === -1) candidates.push(file);
    }
    try { add(host.getSystemPath('extension')); } catch (_) {}
    try { add(host.getSystemPath('appData') + '\\YTX'); } catch (_) {}
    try { add(host.getSystemPath('userData') + '\\YTX'); } catch (_) {}
    try { add(host.getSystemPath('appData') + '\\Adobe\\YTX'); } catch (_) {}
    return candidates;
  }

  function readConfigFile() {
    if (!window.cep || !window.cep.fs || typeof window.cep.fs.readFile !== 'function') {
      throw new Error('Adobe CEP file access is unavailable. Restart the Adobe host and reopen YTX Bridge.');
    }
    var candidates = configCandidates();
    var found = [];
    for (var index = 0; index < candidates.length; index++) {
      try {
        var result = window.cep.fs.readFile(candidates[index]);
        if (result && !result.err && result.data) {
          var parsed = JSON.parse(result.data);
          var port = Number(parsed && parsed.port);
          var token = parsed && String(parsed.token || '');
          if (port > 0 && token) {
            parsed.port = port;
            parsed.token = token;
            parsed.source = candidates[index];
            found.push(parsed);
          }
        }
      } catch (_) {}
    }
    if (!found.length) return null;
    found.sort(function (a, b) {
      var left = Date.parse(a.updatedAt || '') || 0;
      var right = Date.parse(b.updatedAt || '') || 0;
      return right - left;
    });
    return found[0];
  }

  function reloadConfig() {
    config = null;
    mediaLoadedFor = '';
    if (configRetry) { window.clearInterval(configRetry); configRetry = null; }
    return loadConfig();
  }

  function scheduleConfigRetry() {
    if (!configRetry) configRetry = window.setInterval(loadConfig, 2500);
  }

  function loadConfig() {
    try {
      var next = readConfigFile();
      if (!next) throw new Error('Waiting for YTX Studio. Start it once and YTX Bridge connects automatically.');
      config = next;
      if (configRetry) { window.clearInterval(configRetry); configRetry = null; }
      setMessage('YTX Studio found. Connecting…');
      poll();
      startPolling();
      return true;
    } catch (error) {
      setMessage(error.message, true);
      scheduleConfigRetry();
      return false;
    }
  }

  function parseProjectStatus(result) {
    var text = String(result || '');
    if (text.indexOf('OK|') !== 0) return { name: '', folder: '', file: '' };
    var parts = text.slice(3).split('|');
    return { name: parts[0] || '', folder: parts[1] || '', file: parts[2] || '' };
  }

  function readProjectStatus() {
    return evalHost('ytxGetProjectStatus()', 5000)
      .then(parseProjectStatus)
      .catch(function () { return { name: '', folder: '', file: '' }; });
  }

  function mediaKey() {
    return appName + '|' + String(project.folder || '').toLowerCase();
  }

  function renderMedia() {
    var list = node('mediaList');
    var empty = node('mediaEmpty');
    list.replaceChildren();
    node('mediaCount').textContent = String(mediaItems.length);
    if (!mediaItems.length) {
      empty.classList.remove('hidden');
      var hint = empty.querySelector('small');
      if (hint) {
        hint.textContent = project.folder
          ? 'Export from YTX Studio with Send to Premiere or Send to After Effects to add managed media here.'
          : 'Save this Adobe project first. YTX stores managed media beside the project file.';
      }
      return;
    }
    empty.classList.add('hidden');
    for (var index = 0; index < mediaItems.length; index++) {
      var item = mediaItems[index];
      var row = document.createElement('div');
      row.className = 'media-row';

      var icon = document.createElement('span');
      icon.className = 'media-icon';
      icon.textContent = fileLabel(item.name);

      var copy = document.createElement('div');
      copy.className = 'media-copy';
      var name = document.createElement('strong');
      name.textContent = item.name;
      name.title = item.path;
      var meta = document.createElement('small');
      meta.textContent = formatBytes(item.size) + (item.insertedAt ? ' · Inserted' : ' · Ready to insert');
      copy.appendChild(name);
      copy.appendChild(meta);

      var insert = document.createElement('button');
      insert.type = 'button';
      insert.className = 'media-insert';
      insert.textContent = item.insertedAt ? 'Insert again' : 'Insert';
      insert.disabled = busy || !connected || !project.folder;
      insert.addEventListener('click', function (asset) {
        return function () { insertMedia(asset); };
      }(item));

      row.appendChild(icon);
      row.appendChild(copy);
      row.appendChild(insert);
      list.appendChild(row);
    }
    updateMediaButtons();
  }

  function refreshProjectMedia(force, announce) {
    if (!config || !connected) return Promise.resolve();
    if (!project.folder) {
      mediaItems = [];
      mediaLoadedFor = '';
      renderMedia();
      return Promise.resolve();
    }
    var key = mediaKey();
    if (!force && key === mediaLoadedFor && Date.now() - mediaLoadedAt < 8000) return Promise.resolve();
    return request('/bridge/project-media?app=' + encodeURIComponent(appName), null, 8000).then(function (result) {
      if (result && result.error) {
        setMessage(result.error, true);
        return;
      }
      mediaItems = Array.isArray(result && result.items) ? result.items : [];
      mediaLoadedFor = key;
      mediaLoadedAt = Date.now();
      renderMedia();
      if (announce) setMessage(mediaItems.length
        ? mediaItems.length + ' managed asset' + (mediaItems.length === 1 ? '' : 's') + ' in this project.'
        : 'No managed media in this project yet.');
    }).catch(function (error) {
      setMessage(error.message, true);
    });
  }

  function insertMedia(item) {
    if (busy || !config || !item || !item.path) return;
    busy = true;
    updateMediaButtons();
    node('sendSelection').disabled = true;
    setMessage('Inserting ' + item.name + ' into the active ' + (appName === 'premiere' ? 'sequence' : 'composition') + '…');
    var safePath = JSON.stringify(String(item.path));
    evalHost('ytxImportToTimeline(' + safePath + ')', 30000).then(function (result) {
      var text = String(result || '');
      if (text.indexOf('OK|') !== 0) throw new Error(text.replace('ERR|', '') || 'Adobe import failed.');
      setMessage(text.slice(3));
      return request('/bridge/media-imported', { app: appName, path: item.path }, 6000).catch(function () {});
    }).then(function () {
      return refreshProjectMedia(true);
    }).catch(function (error) {
      setMessage(error.message, true);
    }).finally(function () {
      busy = false;
      node('sendSelection').disabled = !connected;
      updateMediaButtons();
    });
  }

  function pollCommand() {
    if (!config) return;
    readProjectStatus().then(function (status) {
      project = status;
      renderProject();
      updateDetails();
      return request('/bridge/heartbeat', {
        app: appName,
        host: node('hostName').textContent,
        project: project.name || 'Unsaved project',
        projectName: project.name || '',
        projectPath: project.folder || '',
        projectFile: project.file || '',
        panelVersion: '2.0.0',
        capabilities: ['import-to-timeline', 'handoff', 'project-media', 'insert-managed-media']
      });
    }).then(function (info) {
      showConnection(info);
      pollCount++;
      if (pollCount % 4 === 1) refreshProjectMedia(false);
      if (busy) return null;
      return request('/bridge/next?app=' + appName);
    }).then(function (command) {
      if (!command || !command.id) return;
      busy = true;
      node('sendSelection').disabled = true;
      updateMediaButtons();
      setMessage('Importing the selected range into the active ' + (appName === 'premiere' ? 'timeline' : 'composition') + '…');
      var safePath = JSON.stringify(String(command.path));
      return evalHost('ytxImportToTimeline(' + safePath + ')', 30000).then(function (result) {
        var text = String(result || '');
        if (text.indexOf('OK|') === 0) {
          setMessage(text.slice(3));
          return request('/bridge/complete', { app: appName, id: command.id, ok: true, message: text.slice(3), progress: 100 }).then(function () {
            return refreshProjectMedia(true);
          });
        }
        throw new Error(text || 'Adobe import failed.');
      }).catch(function (error) {
        setMessage(error.message, true);
        return request('/bridge/complete', { app: appName, id: command.id, ok: false, message: error.message, progress: 100 });
      }).finally(function () {
        busy = false;
        node('sendSelection').disabled = !connected;
        updateMediaButtons();
      });
    }).catch(function (error) {
      showConnection({ connected: false });
      if (!config) {
        setMessage(error.message, true);
        scheduleConfigRetry();
        return;
      }
      if (!/failed to fetch|network|load failed|econnrefused/i.test(String(error.message || ''))) {
        setMessage(error.message, true);
      }
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
      appMark = appName === 'premiere' ? 'Pr' : 'Ae';
      node('hostName').textContent = appName === 'premiere' ? 'Adobe Premiere Pro' : 'Adobe After Effects';
    } catch (error) {
      setMessage('Could not read the Adobe host environment. Restart the Adobe app.', true);
    }
  }

  node('reconnect').addEventListener('click', function () {
    setMessage('Reconnecting to YTX Studio…');
    reloadConfig();
  });
  node('refreshMedia').addEventListener('click', function () {
    if (busy) return;
    setMessage('Refreshing project media…');
    refreshProjectMedia(true, true);
  });

  node('sendSelection').addEventListener('click', function () {
    if (busy || !config) return;
    busy = true;
    node('sendSelection').disabled = true;
    updateMediaButtons();
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
      updateMediaButtons();
    });
  });

  readHostName();
  renderProject();
  renderMedia();
  loadConfig();
  window.addEventListener('error', function (event) { setMessage(event.message || 'Unexpected YTX Bridge error.', true); });
}());
