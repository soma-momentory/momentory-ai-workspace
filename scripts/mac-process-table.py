"""Read same-user Darwin process identities; never read argv or environment."""
import ctypes
import json
import os
import sys

if sys.platform != "darwin":
    raise SystemExit("macOS required")

# Darwin SDK sys/proc_info.h: struct proc_bsdinfo (PROC_PIDTBSDINFO = 3).
class BsdInfo(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint32) for name in (
        "flags", "status", "xstatus", "pid", "ppid", "uid", "gid", "ruid",
        "rgid", "svuid", "svgid", "reserved",
    )] + [
        ("comm", ctypes.c_char * 16), ("name", ctypes.c_char * 32),
        ("nfiles", ctypes.c_uint32), ("pgid", ctypes.c_uint32),
        ("pjobc", ctypes.c_uint32), ("tdev", ctypes.c_uint32),
        ("tpgid", ctypes.c_uint32), ("nice", ctypes.c_int32),
        ("start_sec", ctypes.c_uint64), ("start_usec", ctypes.c_uint64),
    ]

lib = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
lib.proc_listallpids.argtypes = [ctypes.c_void_p, ctypes.c_int]
lib.proc_listallpids.restype = ctypes.c_int
lib.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
lib.proc_pidinfo.restype = ctypes.c_int
count = lib.proc_listallpids(None, 0)
if count < 1 or count > 100000:
    raise SystemExit("Process enumeration failed")
buffer = (ctypes.c_int * (count + 256))()
actual = lib.proc_listallpids(buffer, ctypes.sizeof(buffer))
if actual < 1 or actual > len(buffer):
    raise SystemExit("Process enumeration changed beyond capacity")
rows = []
for pid in buffer[:actual]:
    info = BsdInfo()
    size = lib.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
    if size != ctypes.sizeof(info) or info.uid != os.getuid() or info.status == 5:
        continue
    rows.append({"pid": info.pid, "parent": info.ppid, "group": info.pgid,
                 "identity": "%s:%s" % (info.start_sec, info.start_usec)})
print(json.dumps(rows))
