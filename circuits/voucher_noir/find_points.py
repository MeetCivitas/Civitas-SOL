import sys

# BN254 Curve Parameters
P = 0x30644E72E131A029B85045B68181585D97816A916871CA8D3C208C16D87CFD47
A = 0
B = 3

def is_on_curve(x, y):
    if x >= P or y >= P:
        return False
    return (y * y) % P == (x * x * x + A * x + B) % P

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 find_points.py <vk_file>")
        return

    with open(sys.argv[1], "rb") as f:
        data = f.read()

    print(f"Scanning {len(data)} bytes for BN254 points...")
    
    # Scan every byte offset for a 64-byte sequence (x, y)
    found = 0
    for i in range(len(data) - 63):
        x = int.from_bytes(data[i : i + 32], "big")
        y = int.from_bytes(data[i + 32 : i + 64], "big")
        
        if is_on_curve(x, y):
            print(f"Found point at offset 0x{i:02x}:")
            print(f"  x: {hex(x)}")
            print(f"  y: {hex(y)}")
            found += 1
            if found > 40: break # Skip after identifying many points

    if found == 0:
        print("No points found using Big Endian. Trying Little Endian...")
        for i in range(len(data) - 63):
            x = int.from_bytes(data[i : i + 32], "little")
            y = int.from_bytes(data[i + 32 : i + 64], "little")
            
            if is_on_curve(x, y):
                print(f"Found point (LE) at offset 0x{i:02x}:")
                print(f"  x: {hex(x)}")
                print(f"  y: {hex(y)}")
                found += 1
                if found > 40: break

        if found == 0:
            print("Still nothing. Trying 32-byte offsets only...")
            for i in range(0, len(data) - 63, 32):
                # Try every 32-byte alignment
                 pass # Already covered by range(len(data))

if __name__ == "__main__":
    main()
