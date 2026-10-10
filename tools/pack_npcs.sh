#!/bin/zsh
# Meshopt-compress the NPC GLBs exported by blender/humans.py (gltfpack, MIT). Keeps bone and material names.
cd "$(dirname "$0")/.."
for f in public/assets/npcs/*.glb; do
  [[ $(basename $f) == model.glb ]] && continue
  if python3 -c "import sys,json,struct;b=open(sys.argv[1],'rb').read();l=struct.unpack('<I',b[12:16])[0];sys.exit(0 if 'EXT_meshopt_compression' in json.loads(b[20:20+l]).get('extensionsUsed',[]) else 1)" "$f"; then continue; fi
  npx -y gltfpack@1.3.0 -i "$f" -o "$f.tmp.glb" -cc -kn -km -af 15 >/dev/null
  mv "$f.tmp.glb" "$f"
  echo "packed $f $(( $(stat -f%z "$f") / 1024 )) KB"
done
