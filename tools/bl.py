#!/usr/bin/env python3
"""Client for the local Blender MCP bridge (Blender Lab 'MCP' add-on, localhost:9876).

Usage:  python3 tools/bl.py blender/some_script.py [args...]
        python3 tools/bl.py -c "code"
The executed code sees BL_ARGS (list of extra args) and REPO (repo root path).
Set `result = {...}` inside the script to return data; stdout is printed too.
"""
import socket, json, sys, os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def run(code, timeout=7200):
    s = socket.create_connection(("localhost", 9876), timeout=timeout)
    s.sendall((json.dumps({"type": "execute", "code": code, "strict_json": False}) + "\0").encode())
    buf = b""
    while not buf.endswith(b"\0"):
        chunk = s.recv(1 << 16)
        if not chunk:
            break
        buf += chunk
    s.close()
    return json.loads(buf.rstrip(b"\0").decode())

if __name__ == "__main__":
    if sys.argv[1] == "-c":
        code, args, fname = sys.argv[2], sys.argv[3:], "<inline>"
    else:
        fname = os.path.abspath(sys.argv[1])
        code, args = open(fname).read(), sys.argv[2:]
    pre = "BL_ARGS = %r\nREPO = %r\n__file__ = %r\nimport sys as _s\n_s.path.insert(0, %r)\n" % (
        args, REPO, fname, os.path.join(REPO, "blender"))
    res = run(pre + code)
    if res.get("stdout"): print(res["stdout"], end="")
    if res.get("stderr"): print(res["stderr"], end="", file=sys.stderr)
    if res.get("status") != "ok":
        print(res.get("message", res), file=sys.stderr); sys.exit(1)
    if res.get("result"): print(json.dumps(res["result"]))
