/* YTX Bridge ExtendScript host. Kept ES3-compatible for older CEP hosts. */
function ytxIsPremiere() {
    return BridgeTalk.appName === "premierepro";
}

function ytxNormalizePath(value) {
    return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function ytxProjectItemPath(item) {
    try { return item.getMediaPath(); } catch (error) { return ""; }
}

function ytxFindImportedItem(root, mediaPath) {
    var wanted = ytxNormalizePath(mediaPath);
    for (var index = 0; index < root.children.numItems; index++) {
        var child = root.children[index];
        if (ytxNormalizePath(ytxProjectItemPath(child)) === wanted) return child;
        try {
            if (child.children && child.children.numItems) {
                var nested = ytxFindImportedItem(child, mediaPath);
                if (nested) return nested;
            }
        } catch (error) {}
    }
    return null;
}

function ytxImportPremiere(mediaFile) {
    if (!app.project) app.newProject();
    var project = app.project;
    project.importFiles([mediaFile.fsName], true, project.rootItem, false);
    var imported = ytxFindImportedItem(project.rootItem, mediaFile.fsName);
    if (!imported) return "ERR|Premiere imported the file but YTX could not locate it in the project bin.";
    var sequence = project.activeSequence;
    if (!sequence) {
        sequence = project.createNewSequenceFromClips("YTX Import", [imported]);
        if (!sequence) return "ERR|Premiere could not create a sequence for this media.";
        return "OK|Created a Premiere sequence and imported " + imported.name + ".";
    }
    var position = sequence.getPlayerPosition();
    // Premiere's ExtendScript API expects the playhead as a ticks value.
    var inserted = sequence.videoTracks[0].insertClip(imported, position, 0, 0);
    if (!inserted) return "ERR|Premiere could not insert the clip at the playhead. Make sure V1 is not locked.";
    return "OK|Inserted " + imported.name + " into " + sequence.name + " at the playhead.";
}

function ytxImportAfterEffects(mediaFile) {
    if (!app.project) app.newProject();
    var project = app.project;
    var footage = project.importFile(new ImportOptions(mediaFile));
    if (!footage) return "ERR|After Effects could not import this media.";
    var comp = project.activeItem;
    if (!(comp instanceof CompItem)) {
        var width = footage.width || 1920;
        var height = footage.height || 1080;
        comp = project.items.addComp(mediaFile.displayName, width, height, footage.pixelAspect || 1, footage.duration || 10, footage.frameRate || 30);
        try { comp.openInViewer(); } catch (viewerError) {}
    }
    var layer = comp.layers.add(footage);
    layer.startTime = 0;
    return "OK|Imported " + footage.name + " as a layer in " + comp.name + ".";
}

function ytxImportToTimeline(path) {
    try {
        var mediaFile = new File(path);
        if (!mediaFile.exists) return "ERR|Media file does not exist: " + mediaFile.fsName;
        if (ytxIsPremiere()) return ytxImportPremiere(mediaFile);
        return ytxImportAfterEffects(mediaFile);
    } catch (error) {
        return "ERR|" + error.toString();
    }
}

function ytxGetSelectedMediaPath() {
    try {
        if (ytxIsPremiere()) {
            var selected = app.getCurrentProjectViewSelection();
            if (selected && selected.length) {
                for (var index = 0; index < selected.length; index++) {
                    var path = ytxProjectItemPath(selected[index]);
                    if (path) return path;
                }
            }
            if (app.project.activeSequence) {
                var clips = app.project.activeSequence.getSelection();
                if (clips && clips.length && clips[0].projectItem) {
                    var timelinePath = ytxProjectItemPath(clips[0].projectItem);
                    if (timelinePath) return timelinePath;
                }
            }
            return "ERR|Select a project-bin item or a timeline clip in Premiere.";
        }
        if (!app.project) return "ERR|Open an After Effects project first.";
        var selection = app.project.selection;
        for (var itemIndex = 0; itemIndex < selection.length; itemIndex++) {
            if (selection[itemIndex] instanceof FootageItem && selection[itemIndex].mainSource && selection[itemIndex].mainSource.file) {
                return selection[itemIndex].mainSource.file.fsName;
            }
        }
        return "ERR|Select footage in the After Effects Project panel.";
    } catch (error) {
        return "ERR|" + error.toString();
    }
}

function ytxGetProjectFolder() {
    try {
        if (ytxIsPremiere()) {
            if (!app.project || !app.project.path) return "";
            return new File(app.project.path).parent.fsName;
        }
        if (!app.project || !app.project.file || !app.project.file.exists) return "";
        return app.project.file.parent.fsName;
    } catch (error) {
        return "";
    }
}

function ytxPing() {
    try {
        var hostVersion = "unknown";
        try { hostVersion = app.version; } catch (error) {}
        return "PONG|" + (ytxIsPremiere() ? "premiere" : "aftereffects") + "|" + hostVersion + "|2.0.0";
    } catch (error) {
        return "ERR|" + error.toString();
    }
}

function ytxGetProjectInfo() {
    try {
        var projectName = "";
        var projectPath = ytxGetProjectFolder();
        if (ytxIsPremiere()) projectName = app.project ? app.project.name : "";
        else projectName = app.project && app.project.file ? app.project.file.name : "";
        return "OK|" + projectName + "|" + projectPath;
    } catch (error) {
        return "ERR|" + error.toString();
    }
}
