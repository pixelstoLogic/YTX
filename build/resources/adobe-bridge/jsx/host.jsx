function ytxImportToTimeline(path) {
    try {
        var mediaFile = new File(path);
        if (!mediaFile.exists) return "ERR|Media file does not exist: " + mediaFile.fsName;
        if (BridgeTalk.appName === "premierepro") {
            if (!app.project) app.newProject();
            var project = app.project;
            project.importFiles([mediaFile.fsName], true, project.rootItem, false);
            var imported = null;
            var children = project.rootItem.children;
            for (var i = 0; i < children.numItems; i++) {
                var item = children[i];
                try { if (item.getMediaPath() === mediaFile.fsName) { imported = item; break; } } catch (e) {}
            }
            if (!imported) return "ERR|Premiere imported the file but YTX could not locate it in the project bin.";
            var sequence = project.activeSequence;
            if (!sequence) {
                sequence = project.createNewSequenceFromClips("YTX Import", [imported]);
                if (!sequence) return "ERR|Premiere could not create a sequence for this media.";
            } else {
                var position = sequence.getPlayerPosition();
                sequence.videoTracks[0].insertClip(imported, position.ticks, 0, 0);
            }
            return "OK|Media inserted into the active Premiere timeline.";
        }
        if (!app.project) app.newProject();
        var footage = app.project.importFile(new ImportOptions(mediaFile));
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) {
            comp = app.project.items.addComp(mediaFile.displayName, footage.width, footage.height, footage.pixelAspect, footage.duration || 1, footage.frameRate || 30);
        }
        comp.layers.add(footage);
        return "OK|Media imported as a layer in the active After Effects composition.";
    } catch (err) { return "ERR|" + err.toString(); }
}

function ytxGetSelectedMediaPath() {
    try {
        if (BridgeTalk.appName === "premierepro") {
            var selected = app.getCurrentProjectViewSelection();
            if (selected && selected.length) return selected[0].getMediaPath();
            if (app.project.activeSequence) {
                var clips = app.project.activeSequence.getSelection();
                if (clips && clips.length && clips[0].projectItem) return clips[0].projectItem.getMediaPath();
            }
            return "ERR|Select a project-bin item or a timeline clip in Premiere.";
        }
        var selection = app.project.selection;
        for (var i = 0; i < selection.length; i++) {
            if (selection[i] instanceof FootageItem && selection[i].mainSource.file) return selection[i].mainSource.file.fsName;
        }
        return "ERR|Select footage in the After Effects Project panel.";
    } catch (err) { return "ERR|" + err.toString(); }
}

function ytxGetProjectFolder() {
    try {
        if (BridgeTalk.appName === "premierepro") {
            if (!app.project || !app.project.path) return "";
            return new File(app.project.path).parent.fsName;
        }
        if (!app.project || !app.project.file || !app.project.file.exists) return "";
        return app.project.file.parent.fsName;
    } catch (err) { return ""; }
}

