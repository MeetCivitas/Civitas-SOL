import sys
import struct

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 debug_vk.py <vk_file>")
        return

    with open(sys.argv[1], "rb") as f:
        data = f.read()

    print(f"Total size: {len(data)}")
    
    # Read first 10 fields of 32 bytes each
    for i in range(10):
        chunk = data[i*32 : (i+1)*32]
        if not chunk: break
        val = int.from_bytes(chunk, "big")
        print(f"Field {i} (0x{i*32:02x}-0x{(i+1)*32-1:02x}): {val} (hex: {hex(val)})")

if __name__ == "__main__":
    main()
