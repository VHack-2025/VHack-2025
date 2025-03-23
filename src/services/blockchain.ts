import { ethers, Wallet } from "ethers";
import dotenv from "dotenv";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { getSessionID } from "./session";

dotenv.config();

// hawhaw thanks derek

// Load contract ABI
const MicroLoanArtifact = require("./contracts/MicroLoan.json");
const IERC20Artifact = require("./contracts/IERC20.json");

// Define contract addresses
const MICROLOAN_ADDRESS = process.env.MICROLOAN_ADDRESS!;
const USDC_ADDRESS = process.env.USDC_CONTRACT_ADDRESS!;

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForTransaction(id: string) {
    const client = initiateDeveloperControlledWalletsClient({
        apiKey: process.env.CIRCLE_API_KEY!,
        entitySecret: process.env.CIRCLE_SECRET!
    });

    let done = false, transactionDetails

    while (!done) {
        transactionDetails = await client.getTransaction({
            id: id
        })
        const endStates = [
            "COMPLETE",
            "FAILED",
            "CANCELLED"
        ]

        console.log(
            `Status of Transaction ID: ${transactionDetails.data?.transaction?.id}: ${transactionDetails.data?.transaction?.state}`
        )

        done = endStates.includes(transactionDetails.data!.transaction!.state)
        await sleep(5000)
    }
    return transactionDetails?.data
}

export async function connectToBlockchain() {
    const provider = new ethers.JsonRpcProvider(`https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`)
    const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider)
    return {
        provider: provider,
        signer: signer
    }
}

// what the fuck am i doing
export async function payoutLoan(recvAddr: string, toSend: string) {
    const receiverAddress = recvAddr    
    const usdcContract = await connectToUSDC()

    try {
        const amount = ethers.parseUnits(toSend, 6); // 10 USDC (USDC has 6 decimals)

        console.log(`Sending ${amount} USDC to ${receiverAddress}...`);

        const tx = await usdcContract.transfer(receiverAddress, amount);
        console.log(`Transaction sent! Hash: ${tx.hash}`);

        // Wait for confirmation
        const receipt = await tx.wait();
        console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    } catch (error) {
        console.error("Error sending USDC:", error);
    }
}

export async function getLoanInfo() {
    // Get the signer
    const { provider, signer } = await connectToBlockchain()
    // const [signer] = await ethers.getSigners();
    
    // Connect to MicroLoan contract
    const microLoan = new ethers.Contract(MICROLOAN_ADDRESS, MicroLoanArtifact.abi, signer);
    
    const loan = await microLoan.loans(await getSessionID());
    return loan;
}

export async function connectToUSDC() {
    const { provider, signer } = await connectToBlockchain()
    return new ethers.Contract(USDC_ADDRESS, IERC20Artifact.abi, signer)
}

export async function connectToMicroloan() {
    const { provider, signer } = await connectToBlockchain()
    return new ethers.Contract(MICROLOAN_ADDRESS, MicroLoanArtifact.abi, signer);    
}

export async function depositUSDC(amount: string) {
  // Get the signer
  const { provider, signer } = await connectToBlockchain()

  // Connect to MicroLoan contract
  const microLoan = new ethers.Contract(MICROLOAN_ADDRESS, MicroLoanArtifact.abi, signer);

  // Connect to USDC contract
  const usdc = new ethers.Contract(USDC_ADDRESS, IERC20Artifact.abi, signer);

  // Convert amount to wei (USDC has 6 decimals)
  const amountInWei = ethers.parseUnits(amount, 6);

  // Check USDC balance
  const balance = await usdc.balanceOf(signer.address);
  if (balance < amountInWei) {
    console.error(`Insufficient USDC balance. You have ${ethers.formatUnits(balance, 6)} USDC.`);
    return;
  }

  // Approve USDC transfer
  console.log(`Approving ${amount} USDC...`);
  const approveTx = await usdc.approve(await microLoan.getAddress(), amountInWei);
  await approveTx.wait();
  console.log(`Approved!`);

  // Deposit USDC
  console.log(`Depositing ${amount} USDC...`);
  const depositTx = await microLoan.depositUSDC(amountInWei, await getSessionID());
  await depositTx.wait();
  console.log(`Successfully deposited ${amount} USDC!`);
}

export async function depositCollateral(amount: string) {
    // Get the signer
    const { provider, signer } = await connectToBlockchain()

    // Connect to MicroLoan contract
    const microLoan = new ethers.Contract(MICROLOAN_ADDRESS, MicroLoanArtifact.abi, signer);

    // Convert amount to wei
    const amountInWei = ethers.parseEther(amount);

    // Check ETH balance
    const balance = await provider.getBalance(signer.address);
    if (balance < amountInWei) {
        console.error(`Insufficient ETH balance. You have ${ethers.formatEther(balance)} ETH.`);
        return;
    }

    // Deposit ETH as collateral
    console.log(`Depositing ${amount} ETH as collateral...`);
    const depositTx = await microLoan.depositCollateral(await getSessionID(), { value: amountInWei });
    await depositTx.wait();
    console.log(`Successfully deposited ${amount} ETH as collateral!`);
}

export async function takeLoan(amount: string, receipianAddr: string) {
    // Get the signer
    const { provider, signer } = await connectToBlockchain()

    // Connect to MicroLoan contract
    const microLoan = new ethers.Contract(MICROLOAN_ADDRESS, MicroLoanArtifact.abi, signer);

    // Get loan details
    const loan = await microLoan.loans(await getSessionID());
    if (loan.active) {
        console.error("You already have an active loan!");
        return;
    }

    if (loan.collateralAmount == 0) {
        console.error("You must deposit collateral before taking a loan!");
        return;
    }

    // Convert amount to wei (USDC has 6 decimals)
    const amountInWei = ethers.parseUnits(amount, 6);

    // Check available USDC
    const availableUSDC = await microLoan.availableUSDC();
    if (availableUSDC < amountInWei) {
        console.error(`Insufficient USDC liquidity. Available: ${ethers.formatUnits(availableUSDC, 6)} USDC`);
        return;
    }

    // Take loan
    console.log(`Taking loan of ${amount} USDC...`);
    const takeLoanTx = await microLoan.takeLoan(amountInWei, await getSessionID(), receipianAddr);
    await takeLoanTx.wait();
    console.log(`Successfully borrowed ${amount} USDC!`);
    return amount
}


export async function getLoanDetails() {
    // Get the signer
    const { provider, signer } = await connectToBlockchain()

    // Connect to MicroLoan contract
    const microLoan = new ethers.Contract(MICROLOAN_ADDRESS, MicroLoanArtifact.abi, signer);
    const loan = await microLoan.getLoanInfo(await getSessionID())

    const res = {
        loanAmount: ethers.formatUnits(loan.loanAmount, 6), // in usdc
        collateralAmount: ethers.formatEther(loan.collateralAmount), // in eth
        startTime: Number(loan.startTime),
        endTime: Number(loan.endTime),
        active: loan.active,
        liquidated: loan.liquidated,
        interest: ethers.formatUnits(loan.interest, 6),
        totalDue: ethers.formatUnits(loan.loanAmount + loan.interest, 6),
    }
   return res
}

export async function repayLoan(amount: string) {
    // Get the signer
    const { provider, signer } = await connectToBlockchain()

    // Connect to MicroLoan contract
    const microLoan = new ethers.Contract(MICROLOAN_ADDRESS, MicroLoanArtifact.abi, signer);

    // Connect to USDC contract
    const usdc = new ethers.Contract(USDC_ADDRESS, IERC20Artifact.abi, signer);

    // Get loan details
    const loan = await microLoan.loans(await getSessionID());
    if (!loan.active) {
        console.error("You don't have an active loan to repay!");
        return;
    }

    // Calculate interest
    const interest = await microLoan.calculateBorrowerInterest(await getSessionID());
    const totalDue = loan.loanAmount + interest;
    console.log(`Loan amount: ${ethers.formatUnits(loan.loanAmount, 6)} USDC`);
    console.log(`Interest accrued: ${ethers.formatUnits(interest, 6)} USDC`);
    console.log(`Total due: ${ethers.formatUnits(totalDue, 6)} USDC`);

    // // Convert amount to wei (USDC has 6 decimals)
    const amountInWei = ethers.parseUnits(amount, 6);
    // if (amountInWei > totalDue) {
    //     console.error(`Repayment amount exceeds total due. Maximum: ${ethers.formatUnits(totalDue, 6)} USDC`);
    //     return;
    // }

    // // Check USDC balance
    // const balance = await usdc.balanceOf(signer.address);
    // if (balance < amountInWei) {
    //     console.error(`Insufficient USDC balance. You have ${ethers.formatUnits(balance, 6)} USDC.`);
    //     return;
    // }

    // Approve USDC transfer
    console.log(`Approving ${amount} USDC...`);
    const approveTx = await usdc.approve(await microLoan.getAddress(), amountInWei);
    await approveTx.wait();
    console.log(`Approved!`);

    // Repay loan
    console.log(`Repaying ${amount} USDC...`);
    const repayTx = await microLoan.repayLoan(amountInWei, await getSessionID());
    await repayTx.wait();
    console.log(`Successfully repaid ${amount} USDC!`);

    // Check if loan is fully repaid
    const updatedLoan = await microLoan.loans(await getSessionID());
    if (!updatedLoan.active) {
        console.log(`🎉 Loan fully repaid! Your collateral has been returned.`);
    } else {
        console.log(`Remaining loan amount: ${ethers.formatUnits(updatedLoan.loanAmount, 6)} USDC`);
    }
}
