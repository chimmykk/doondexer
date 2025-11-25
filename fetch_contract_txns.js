#!/usr/bin/env node
/**
 * Script to fetch transactions from Monad network incrementally
 * Processes blocks one by one and saves progress after each block
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC_URL = "https://rpc4.monad.xyz";
const PROGRESS_FILE = "indexer_progress.json";
const OUTPUT_DIR = "transactions";

// Load or initialize progress
function loadProgress() {
    if (fs.existsSync(PROGRESS_FILE)) {
        const data = fs.readFileSync(PROGRESS_FILE, 'utf8');
        return JSON.parse(data);
    }
    return { lastProcessedBlock: null, totalTransactions: 0 };
}

// Save progress
function saveProgress(blockNumber, totalTxns) {
    const progress = {
        lastProcessedBlock: blockNumber,
        totalTransactions: totalTxns,
        lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// Save transactions for a block
function saveBlockTransactions(blockNumber, transactions) {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const filename = path.join(OUTPUT_DIR, `block_${blockNumber}.json`);
    const data = {
        blockNumber,
        transactionCount: transactions.length,
        timestamp: new Date().toISOString(),
        transactions
    };

    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    return filename;
}

async function processBlock(provider, blockNum) {
    const transactions = [];

    try {
        const blockData = await provider.getBlock(blockNum, true);

        if (!blockData || !blockData.transactions || blockData.transactions.length === 0) {
            return transactions;
        }

        // getBlock() returns transaction hashes as strings, not full transaction objects
        // We need to fetch each transaction individually
        for (const txHash of blockData.transactions) {
            try {
                // Fetch the full transaction object
                const tx = await provider.getTransaction(txHash);
                // Fetch transaction receipt for status
                const receipt = await provider.getTransactionReceipt(txHash);

                if (!tx) {
                    console.log(`   [WARNING] Could not fetch transaction ${txHash}`);
                    continue;
                }

                const inputData = tx.data || "0x";

                // Determine status
                let status = "Unknown";
                if (receipt) {
                    if (receipt.status === 1) {
                        status = "Success";
                    } else if (receipt.status === 0) {
                        status = "Fail";
                    }
                }

                transactions.push({
                    hash: tx.hash,
                    blockNumber: tx.blockNumber,
                    from: tx.from,
                    to: tx.to || "Contract Creation",
                    value: tx.value ? tx.value.toString() : "0",
                    gas: tx.gasLimit ? tx.gasLimit.toString() : "0",
                    gasPrice: tx.gasPrice ? tx.gasPrice.toString() : "0",
                    input: inputData.length > 10 ? inputData.substring(0, 10) + "..." : inputData,
                    nonce: tx.nonce !== undefined ? tx.nonce : 0,
                    type: tx.type !== undefined ? tx.type : null,
                    chainId: tx.chainId ? tx.chainId.toString() : "unknown",
                    status: status
                });
            } catch (txError) {
                console.error(`   [ERROR] Error fetching transaction ${txHash}: ${txError.message}`);
            }
        }
    } catch (error) {
        console.error(`Error processing block ${blockNum}: ${error.message}`);
    }

    return transactions;
}

async function main() {
    console.log("Starting Monad Network Indexer...");
    console.log(`RPC URL: ${RPC_URL}\n`);

    // Create provider
    const provider = new ethers.JsonRpcProvider(RPC_URL);

    // Load progress to determine start block
    let progress = loadProgress();
    let nextBlockToProcess;

    if (progress.lastProcessedBlock) {
        nextBlockToProcess = progress.lastProcessedBlock + 1;
        console.log(`Resuming from block ${nextBlockToProcess} (last processed: ${progress.lastProcessedBlock})`);
    } else {
        // If no progress file, start from current block
        nextBlockToProcess = await provider.getBlockNumber();
        console.log(`First run - starting from current block: ${nextBlockToProcess}`);
    }

    // Run continuously
    while (true) {
        try {
            // Get latest block on chain
            const latestBlock = await provider.getBlockNumber();

            // Process all blocks from nextBlockToProcess up to latestBlock
            if (nextBlockToProcess <= latestBlock) {
                // Calculate lag for logging
                const lag = latestBlock - nextBlockToProcess;

                console.log(`\n[${new Date().toISOString()}] Processing block ${nextBlockToProcess} (Lag: ${lag})`);

                const transactions = await processBlock(provider, nextBlockToProcess);

                if (transactions.length > 0) {
                    const filename = saveBlockTransactions(nextBlockToProcess, transactions);
                    console.log(`   [SUCCESS] Found ${transactions.length} transactions - saved to ${filename}`);

                    // Update progress object
                    progress.totalTransactions += transactions.length;
                    progress.lastProcessedBlock = nextBlockToProcess;

                    // Save to file
                    saveProgress(nextBlockToProcess, progress.totalTransactions);
                    console.log(`   Total transactions indexed: ${progress.totalTransactions}`);
                } else {
                    console.log(`   [INFO] No transactions in this block`);

                    // Update progress object
                    progress.lastProcessedBlock = nextBlockToProcess;

                    // Save to file
                    saveProgress(nextBlockToProcess, progress.totalTransactions);
                }

                // Move to next block
                nextBlockToProcess++;
            } else {
                // Caught up to chain tip, wait for new blocks
                process.stdout.write('.');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

        } catch (error) {
            console.error(`\n[ERROR] ${error.message}`);
            console.log('Retrying in 5 seconds...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

main().catch(console.error);
