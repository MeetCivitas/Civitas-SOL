import { Connection, PublicKey } from "@solana/web3.js";
const PROGRAM = new PublicKey("BW2wwxbsSjixSfXNGoD9ajoUq8394ZkB2Fn9PusXjJfs");
const AUTHORITY = new PublicKey("Pga9oB2E7XqJwaZijcczrL24b7YgXGfR3sXC2ySoLnX");
const [pda] = PublicKey.findProgramAddressSync([Buffer.from("civ_treasury"), AUTHORITY.toBuffer()], PROGRAM);
const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const info = await conn.getAccountInfo(pda);
console.log("Treasury PDA:", pda.toBase58());
console.log("Exists:", !!info, info ? `(${info.data.length} bytes, owner: ${info.owner.toBase58()})` : "");
