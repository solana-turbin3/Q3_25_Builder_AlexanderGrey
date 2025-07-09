import bs58 from 'bs58';
import prompt from 'prompt-sync';

const promptSync = prompt();

function base58ToWallet() {
    console.log("Enter your base58 private key:");
    const base58 = promptSync("");
    
    if (!base58) {
        console.error("No input provided");
        return;
    }
    
    try {
        const wallet = bs58.decode(base58);
        console.log(`[${Array.from(wallet).join(',')}]`);
    } catch (error) {
        console.error("Invalid base58 string:", error);
    }
}

function walletToBase58() {
    console.log("Enter your wallet array (comma-separated numbers):");
    const input = promptSync("");
    
    if (!input) {
        console.error("No input provided");
        return;
    }
    
    try {
        const wallet = input.split(',').map((n: string) => parseInt(n.trim()));
        const base58 = bs58.encode(Buffer.from(wallet));
        console.log(base58);
    } catch (error) {
        console.error("Invalid wallet array:", error);
    }
}

const args = process.argv.slice(2);

if (args[0] === 'to-wallet') {
    base58ToWallet();
} else if (args[0] === 'to-base58') {
    walletToBase58();
} else {
    console.log("Usage:");
    console.log("  yarn ts-node wallet-converter.ts to-wallet   # Convert base58 to wallet array");
    console.log("  yarn ts-node wallet-converter.ts to-base58   # Convert wallet array to base58");
} 