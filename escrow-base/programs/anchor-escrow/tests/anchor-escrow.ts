import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorEscrow } from "../target/types/anchor_escrow";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddress
} from "@solana/spl-token";
import { assert } from "chai";

describe("anchor-escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AnchorEscrow as Program<AnchorEscrow>;
  
  let mintA: PublicKey;
  let mintB: PublicKey;
  let makerAtaA: PublicKey;
  let makerAtaB: PublicKey;
  let takerAtaA: PublicKey;
  let takerAtaB: PublicKey;
  let vault: PublicKey;
  let escrow: PublicKey;
  let escrowBump: number;
  let seed = new anchor.BN(1);
  
  const maker = anchor.web3.Keypair.generate();
  const taker = anchor.web3.Keypair.generate();
  
  const depositAmount = new anchor.BN(50);
  const receiveAmount = new anchor.BN(100);

  before(async () => {
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(maker.publicKey, 10000000000),
      "confirmed"
    );
    
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(taker.publicKey, 10000000000),
      "confirmed"
    );

    mintA = await createMint(
      provider.connection,
      maker,
      maker.publicKey,
      null,
      6
    );

    mintB = await createMint(
      provider.connection,
      maker,
      maker.publicKey,
      null,
      6
    );

    makerAtaA = await getAssociatedTokenAddress(
      mintA,
      maker.publicKey
    );

    makerAtaB = await getAssociatedTokenAddress(
      mintB,
      maker.publicKey
    );

    takerAtaA = await getAssociatedTokenAddress(
      mintA,
      taker.publicKey
    );

    takerAtaB = await getAssociatedTokenAddress(
      mintB,
      taker.publicKey
    );

    await createAccount(
      provider.connection,
      maker,
      mintA,
      maker.publicKey,
      makerAtaA
    );

    await createAccount(
      provider.connection,
      maker,
      mintB,
      maker.publicKey,
      makerAtaB
    );

    await createAccount(
      provider.connection,
      taker,
      mintA,
      taker.publicKey,
      takerAtaA
    );

    await createAccount(
      provider.connection,
      taker,
      mintB,
      taker.publicKey,
      takerAtaB
    );

    await mintTo(
      provider.connection,
      maker,
      mintA,
      makerAtaA,
      maker.publicKey,
      depositAmount.toNumber()
    );

    await mintTo(
      provider.connection,
      maker,
      mintB,
      takerAtaB,
      maker.publicKey,
      receiveAmount.toNumber()
    );

    [escrow] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        maker.publicKey.toBuffer(),
        seed.toArrayLike(Buffer, "le", 8)
      ],
      program.programId
    );

    [vault] = await PublicKey.findProgramAddress(
      [Buffer.from("vault"), escrow.toBuffer()],
      program.programId
    );
  });

  it("Initialize escrow", async () => {
    await program.methods
      .initialize(
        seed,
        depositAmount,
        receiveAmount
      )
      .accounts({
        maker: maker.publicKey,
        mintA,
        mintB,
        makerAtaA,
        escrow,
        vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([maker])
      .rpc();

    const escrowAccount = await program.account.escrow.fetch(escrow);
    assert.ok(escrowAccount.maker.equals(maker.publicKey));
    assert.ok(escrowAccount.mintA.equals(mintA));
    assert.ok(escrowAccount.mintB.equals(mintB));
    assert.ok(escrowAccount.receive.eq(receiveAmount));

    const vaultAccount = await getAccount(provider.connection, vault);
    assert.ok(vaultAccount.amount === depositAmount.toNumber());
  });

  it("Take escrow", async () => {
    const makerAtaBBalance = (await getAccount(provider.connection, makerAtaB)).amount;
    const takerAtaABalance = (await getAccount(provider.connection, takerAtaA)).amount;

    await program.methods
      .take()
      .accounts({
        taker: taker.publicKey,
        maker: maker.publicKey,
        mintA,
        mintB,
        takerAtaB,
        takerAtaA,
        makerAtaB,
        escrow,
        vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([taker])
      .rpc();

    const newMakerAtaBBalance = (await getAccount(provider.connection, makerAtaB)).amount;
    const newTakerAtaABalance = (await getAccount(provider.connection, takerAtaA)).amount;

    assert.ok(newMakerAtaBBalance === makerAtaBBalance + receiveAmount.toNumber());
    assert.ok(newTakerAtaABalance === takerAtaABalance + depositAmount.toNumber());

    try {
      await program.account.escrow.fetch(escrow);
      assert.fail("Escrow account should be closed");
    } catch (e) {
      assert.ok(e);
    }
  });

  it("Initialize escrow for refund test", async () => {
    await mintTo(
      provider.connection,
      maker,
      mintA,
      makerAtaA,
      maker.publicKey,
      depositAmount.toNumber()
    );

    await program.methods
      .initialize(
        seed,
        depositAmount,
        receiveAmount
      )
      .accounts({
        maker: maker.publicKey,
        mintA,
        mintB,
        makerAtaA,
        escrow,
        vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([maker])
      .rpc();
  });

  it("Refund escrow", async () => {
    const makerAtaABalance = (await getAccount(provider.connection, makerAtaA)).amount;

    await program.methods
      .refund()
      .accounts({
        maker: maker.publicKey,
        mintA,
        makerAtaA,
        escrow,
        vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([maker])
      .rpc();

    const newMakerAtaABalance = (await getAccount(provider.connection, makerAtaA)).amount;
    assert.ok(newMakerAtaABalance === makerAtaABalance + depositAmount.toNumber());

    try {
      await program.account.escrow.fetch(escrow);
      assert.fail("Escrow account should be closed");
    } catch (e) {
      assert.ok(e);
    }
  });
});
