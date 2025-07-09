import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Program, Wallet, AnchorProvider, setProvider } from "@coral-xyz/anchor";
import { REAL_IDL } from "./programs/real_idl";
import wallet from "./Turbin3-wallet.json";

const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const SYSTEM_PROGRAM_ID = SystemProgram.programId;
const PROGRAM_ID = new PublicKey("TRBZyQHB3m68FGeVsqTK39Wm4xejadjVhP5MAZaKWDM");

const keypair = Keypair.fromSecretKey(new Uint8Array(wallet));

const connection = new Connection("https://api.devnet.solana.com");

const provider = new AnchorProvider(connection, new Wallet(keypair), {
    commitment: "confirmed"
});

setProvider(provider);

const program = new Program(REAL_IDL as any, provider);

console.log("Program ID:", PROGRAM_ID.toBase58());
console.log("User public key:", keypair.publicKey.toBase58());

const account_seeds = [
    Buffer.from("prereqs"),
    keypair.publicKey.toBuffer(),
];
const [account_key, _account_bump] = PublicKey.findProgramAddressSync(account_seeds, PROGRAM_ID);

const mintCollection = new PublicKey("5ebsp5RChCGK7ssRZMVMufgVZhd2kFbNaotcZ5UvytN2");

const authority_seeds = [
    Buffer.from("collection"),
    mintCollection.toBuffer(),
];
const [authority, _authority_bump] = PublicKey.findProgramAddressSync(authority_seeds, PROGRAM_ID);

const mintTs = Keypair.generate();


const GITHUB_USERNAME = "AlexGreyEntropy";


(async () => {
    try {
        console.log("Submitting TypeScript completion:");
        console.log("- User:", keypair.publicKey.toBase58());
        console.log("- Account PDA:", account_key.toBase58());
        console.log("- Mint:", mintTs.publicKey.toBase58());
        console.log("- Collection:", mintCollection.toBase58());
        console.log("- Authority PDA:", authority.toBase58());
        
        const txhash = await program.methods
            .submitTs()
            .accounts({
                user: keypair.publicKey,
                account: account_key,
                mint: mintTs.publicKey,
                collection: mintCollection,
                authority: authority,
                mpl_core_program: MPL_CORE_PROGRAM_ID,
                system_program: SYSTEM_PROGRAM_ID,
            })
            .signers([keypair, mintTs])
            .rpc();
        console.log(`Success! Check out your TX here: https://explorer.solana.com/tx/${txhash}?cluster=devnet`);
    } catch (e: any) {
        console.error(`Oops, something went wrong:`);
        console.error(e);
        if (e.logs) {
            console.error("Transaction logs:", e.logs);
        }
    }
})(); 