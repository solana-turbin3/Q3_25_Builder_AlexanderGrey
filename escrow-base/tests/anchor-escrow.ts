import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorEscrow } from "../target/types/anchor_escrow";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
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
  let seed = new anchor.BN(1);
  
  const maker = anchor.web3.Keypair.generate();
  const taker = anchor.web3.Keypair.generate();
  
  const depositAmount = new anchor.BN(50);
  const receiveAmount = new anchor.BN(100);

  before(async () => {
    // Airdrop SOL to maker and taker
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(maker.publicKey, 10000000000),
      "confirmed"
    );
    
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(taker.publicKey, 10000000000),
      "confirmed"
    );

    // Create token mints
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

    // Create associated token accounts
    makerAtaA = await createAssociatedTokenAccount(
      provider.connection,
      maker,
      mintA,
      maker.publicKey
    );

    makerAtaB = await createAssociatedTokenAccount(
      provider.connection,
      maker,
      mintB,
      maker.publicKey
    );

    takerAtaA = await createAssociatedTokenAccount(
      provider.connection,
      taker,
      mintA,
      taker.publicKey
    );

    takerAtaB = await createAssociatedTokenAccount(
      provider.connection,
      taker,
      mintB,
      taker.publicKey
    );

    // Mint initial tokens
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

    // Derive PDAs
    [escrow] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        maker.publicKey.toBuffer(),
        seed.toArrayLike(Buffer, "le", 8)
      ],
      program.programId
    );

    vault = await getAssociatedTokenAddress(
      mintA,
      escrow,
      true
    );
  });

  it("Initialize escrow", async () => {
    // Record initial balances
    const initialMakerAtaABalance = (await getAccount(provider.connection, makerAtaA)).amount;

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

    // Verify escrow account data
    const escrowAccount = await program.account.escrow.fetch(escrow);
    assert.ok(escrowAccount.maker.equals(maker.publicKey));
    assert.ok(escrowAccount.mintA.equals(mintA));
    assert.ok(escrowAccount.mintB.equals(mintB));
    assert.ok(escrowAccount.receive.eq(receiveAmount));

    // Verify tokens were transferred to vault
    const vaultAccount = await getAccount(provider.connection, vault);
    assert.ok(vaultAccount.amount === BigInt(depositAmount.toString()));

    // Verify maker's token A balance decreased
    const makerAtaAAccount = await getAccount(provider.connection, makerAtaA);
    assert.ok(makerAtaAAccount.amount === initialMakerAtaABalance - BigInt(depositAmount.toString()));
  });

  it("Take escrow", async () => {
    // Record initial balances
    const makerAtaBBalance = (await getAccount(provider.connection, makerAtaB)).amount;
    const takerAtaABalance = (await getAccount(provider.connection, takerAtaA)).amount;
    const takerAtaBBalance = (await getAccount(provider.connection, takerAtaB)).amount;
    const vaultBalance = (await getAccount(provider.connection, vault)).amount;

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

    // Verify token transfers
    const newMakerAtaBBalance = (await getAccount(provider.connection, makerAtaB)).amount;
    const newTakerAtaABalance = (await getAccount(provider.connection, takerAtaA)).amount;
    const newTakerAtaBBalance = (await getAccount(provider.connection, takerAtaB)).amount;

    // Maker received payment
    assert.ok(newMakerAtaBBalance === makerAtaBBalance + BigInt(receiveAmount.toString()));
    
    // Taker received escrowed tokens
    assert.ok(newTakerAtaABalance === takerAtaABalance + vaultBalance);
    
    // Taker's payment was deducted
    assert.ok(newTakerAtaBBalance === takerAtaBBalance - BigInt(receiveAmount.toString()));

    // Verify escrow and vault accounts were closed
    try {
      await program.account.escrow.fetch(escrow);
      assert.fail("Escrow account should be closed");
    } catch (e) {
      assert.ok(e);
    }

    try {
      await getAccount(provider.connection, vault);
      assert.fail("Vault account should be closed");
    } catch (e) {
      assert.ok(e);
    }
  });

  it("Initialize escrow for refund test", async () => {
    // Mint new tokens for maker
    await mintTo(
      provider.connection,
      maker,
      mintA,
      makerAtaA,
      maker.publicKey,
      depositAmount.toNumber()
    );

    const initialMakerAtaABalance = (await getAccount(provider.connection, makerAtaA)).amount;

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

    // Verify escrow was created
    const escrowAccount = await program.account.escrow.fetch(escrow);
    assert.ok(escrowAccount.maker.equals(maker.publicKey));

    // Verify tokens were transferred
    const makerAtaAAccount = await getAccount(provider.connection, makerAtaA);
    assert.ok(makerAtaAAccount.amount === initialMakerAtaABalance - BigInt(depositAmount.toString()));

    const vaultAccount = await getAccount(provider.connection, vault);
    assert.ok(vaultAccount.amount === BigInt(depositAmount.toString()));
  });

  it("Refund escrow", async () => {
    // Record initial balances
    const makerAtaABalance = (await getAccount(provider.connection, makerAtaA)).amount;
    const vaultBalance = (await getAccount(provider.connection, vault)).amount;

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

    // Verify tokens were returned to maker
    const newMakerAtaABalance = (await getAccount(provider.connection, makerAtaA)).amount;
    assert.ok(newMakerAtaABalance === makerAtaABalance + vaultBalance);

    // Verify escrow and vault accounts were closed
    try {
      await program.account.escrow.fetch(escrow);
      assert.fail("Escrow account should be closed");
    } catch (e) {
      assert.ok(e);
    }

    try {
      await getAccount(provider.connection, vault);
      assert.fail("Vault account should be closed");
    } catch (e) {
      assert.ok(e);
    }
  });

  it("Should fail when non-maker tries to refund", async () => {
    // First initialize a new escrow
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

    // Try to refund with taker - should fail
    try {
      await program.methods
        .refund()
        .accounts({
          maker: taker.publicKey,
          mintA,
          makerAtaA,
          escrow,
          vault,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([taker])
        .rpc();
      assert.fail("Should fail when non-maker tries to refund");
    } catch (e) {
      assert.ok(e);
      // Verify error is the expected one
      const err = e as anchor.AnchorError;
      assert.strictEqual(err.error.errorCode.code, "ConstraintHasOne");
    }

    // Clean up - refund properly with maker
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
  });

  it("Should fail when taker has insufficient funds", async () => {
    // Initialize escrow
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

    // Drain taker's token B balance
    const takerAtaBAccount = await getAccount(provider.connection, takerAtaB);
    if (takerAtaBAccount.amount > 0) {
      // Transfer all tokens away
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
    }

    // Try to take escrow with insufficient funds - should fail
    try {
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
      assert.fail("Should fail when taker has insufficient funds");
    } catch (e) {
      assert.ok(e);
      // Verify it's a token insufficient funds error
      const err = e as Error;
      assert.ok(err.message.includes("0x1"));
    }
  });
}); 