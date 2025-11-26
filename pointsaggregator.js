const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Configuration
const RPC_URL = "https://rpc3.monad.xyz";
const NFT_CONTRACT_ADDRESS = "0x202b6523e33369722C170F41599ec32722181480";
const TARGET_CONTRACT = "0xcA5C2a5688f6C824d029F3A23B75082c5f75b442";
const TRANSACTIONS_DIR = path.join(__dirname, 'transactions');

// Points configuration
const BASE_POINTS_PER_TXN = 100;
const NFT_HOLDER_MULTIPLIER = 1.1;

// ERC721 ABI - only the functions we need
const ERC721_ABI = [
    "function balanceOf(address owner) view returns (uint256)"
];

/**
 * Check if an address holds any NFTs from the collection
 */
async function checkNFTBalance(address) {
    try {
        console.log(`\nChecking NFT balance for ${address}...`);

        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const nftContract = new ethers.Contract(
            NFT_CONTRACT_ADDRESS,
            ERC721_ABI,
            provider
        );

        const balance = await nftContract.balanceOf(address);
        const balanceNumber = Number(balance);

        console.log(`  ✓ NFT Balance: ${balanceNumber}`);

        return balanceNumber > 0;
    } catch (error) {
        console.error('  ✗ Error checking NFT balance:', error.message);
        return false;
    }
}

/**
 * Get all transaction JSON files
 */
function getTransactionFiles() {
    if (!fs.existsSync(TRANSACTIONS_DIR)) {
        console.log(`  ✗ Transactions directory not found: ${TRANSACTIONS_DIR}`);
        return [];
    }

    const files = fs.readdirSync(TRANSACTIONS_DIR);
    const jsonFiles = files.filter(file => file.endsWith('.json') && file.startsWith('block_'));

    return jsonFiles.map(file => path.join(TRANSACTIONS_DIR, file));
}

/**
 * Count successful transactions from address to target contract
 */
function countSuccessfulTransactions(address) {
    console.log(`\nChecking transactions for ${address}...`);

    const transactionFiles = getTransactionFiles();
    console.log(`  Found ${transactionFiles.length} transaction files to check`);

    let successfulTxnCount = 0;
    const matchingTxns = [];

    for (const filePath of transactionFiles) {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const data = JSON.parse(fileContent);

            // Handle the nested structure: data.transactions is the array
            const transactions = data.transactions || [];

            for (const txn of transactions) {
                // Check if transaction is from the address, to the target contract, and successful
                if (txn.from && txn.to && txn.status) {
                    const fromMatch = txn.from.toLowerCase() === address.toLowerCase();
                    const toMatch = txn.to.toLowerCase() === TARGET_CONTRACT.toLowerCase();
                    const isSuccess = txn.status === 'Success';

                    if (fromMatch && toMatch && isSuccess) {
                        successfulTxnCount++;
                        matchingTxns.push({
                            hash: txn.hash,
                            blockNumber: txn.blockNumber,
                            value: txn.value
                        });
                    }
                }
            }
        } catch (error) {
            console.log(`  ! Error reading ${path.basename(filePath)}: ${error.message}`);
        }
    }

    console.log(`  ✓ Found ${successfulTxnCount} successful transaction(s) to ${TARGET_CONTRACT}`);

    if (matchingTxns.length > 0) {
        console.log(`\n  Matching transactions:`);
        matchingTxns.forEach((txn, index) => {
            console.log(`    ${index + 1}. Hash: ${txn.hash}`);
            console.log(`       Block: ${txn.blockNumber}, Value: ${txn.value}`);
        });
    }

    return successfulTxnCount;
}

/**
 * Calculate total points for an address
 */
async function calculatePoints(address) {
    console.log('='.repeat(80));
    console.log(`POINTS AGGREGATOR - Address: ${address}`);
    console.log('='.repeat(80));

    // Check NFT holdings
    const holdsNFT = await checkNFTBalance(address);

    // Count successful transactions
    const txnCount = countSuccessfulTransactions(address);

    // Calculate points
    const basePoints = txnCount * BASE_POINTS_PER_TXN;
    const multiplier = holdsNFT ? NFT_HOLDER_MULTIPLIER : 1.0;
    const totalPoints = Math.floor(basePoints * multiplier);

    // Display results
    console.log('\n' + '='.repeat(80));
    console.log('RESULTS');
    console.log('='.repeat(80));
    console.log(`NFT Holder: ${holdsNFT ? 'YES ✓' : 'NO ✗'}`);
    console.log(`Multiplier: ${multiplier}x`);
    console.log(`Successful Transactions: ${txnCount}`);
    console.log(`Base Points: ${basePoints} (${txnCount} txns × ${BASE_POINTS_PER_TXN} points)`);
    console.log(`Total Points: ${totalPoints} ${holdsNFT ? '(with NFT bonus)' : ''}`);
    console.log('='.repeat(80));

    return {
        address,
        holdsNFT,
        multiplier,
        txnCount,
        basePoints,
        totalPoints
    };
}

// Main execution
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.error('Usage: node pointsaggregator.js <address>');
        console.error('Example: node pointsaggregator.js 0x84A7818F15D42e77EC028DDe50D84Db82FEBf46D');
        process.exit(1);
    }

    const address = args[0];

    // Validate address format
    if (!ethers.isAddress(address)) {
        console.error(`Error: Invalid Ethereum address: ${address}`);
        process.exit(1);
    }

    calculatePoints(address)
        .then(result => {
            console.log('\nDone!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\nError:', error.message);
            console.error(error);
            process.exit(1);
        });
}

module.exports = { calculatePoints, checkNFTBalance, countSuccessfulTransactions };
