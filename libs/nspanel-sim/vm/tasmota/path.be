# path.be -- the path module (be_path_tasmota_lib.c), over the page's file system.
# Tasmota's own load() and persist ask it whether a file is there, and persist moves its temporary file over the file with rename.
import json

var path = module("path")
path.exists = def (f) return _host("fs_exists", str(f)) == "1" end
path.isdir = def (f) return _host("fs_isdir", str(f)) == "1" end
path.remove = def (f) return _host("fs_remove", str(f)) == "1" end
path.rename = def (a, b) return _host("fs_rename", json.dump([str(a), str(b)])) == "1" end
path.mkdir = def (f) return _host("fs_mkdir", str(f)) == "1" end
path.rmdir = def (f) return _host("fs_remove", str(f)) == "1" end
path.last_modified = def (f)
    var t = _host("fs_mtime", str(f))
    return t != nil ? int(t) : nil
end
path.listdir = def (d)
    var l = _host("fs_list", d != nil ? str(d) : "/")
    return l != nil ? json.load(l) : []
end
return path
