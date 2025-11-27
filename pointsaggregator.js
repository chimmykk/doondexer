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
const NFT_MULTIPLIERS = {
    0: 1.0,   // No NFTs
    1: 1.1,   // 1 NFT
    2: 1.3    // 2+ NFTs
};

// ERC721 ABI - only the functions we need
const ERC721_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function totalSupply() view returns (uint256)"
];

/**
 * Check NFT balance for an address and return the count and token IDs
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

        // If balance is 0, no need to enumerate
        if (balanceNumber === 0) {
            return { balance: 0, tokenIds: [] };
        }

        // Enumerate token IDs
        const tokenIds = [];
        let method1Success = false;

        // Method 1: Try tokenOfOwnerByIndex (more efficient)
        try {
            for (let i = 0; i < balanceNumber; i++) {
                const tokenId = await nftContract.tokenOfOwnerByIndex(address, i);
                tokenIds.push(tokenId.toString());
                console.log(`  ✓ Token #${i + 1}: ID ${tokenId.toString()}`);
            }
            method1Success = true;
        } catch (error) {
            // Method 1 failed, try Method 2
            tokenIds.length = 0; // Reset
        }

        // Method 2: Fallback to ownerOf enumeration
        if (!method1Success) {
            // Try to get total supply to limit search range
            let maxCheck = 10000;
            try {
                const totalSupply = await nftContract.totalSupply();
                maxCheck = Math.min(Number(totalSupply), 10000);
            } catch (error) {
                maxCheck = Math.min(10000, balanceNumber * 20);
            }

            for (let id = 1; id <= maxCheck && tokenIds.length < balanceNumber; id++) {
                try {
                    const owner = await nftContract.ownerOf(id);
                    if (owner.toLowerCase() === address.toLowerCase()) {
                        tokenIds.push(id.toString());
                        console.log(`  ✓ Token #${tokenIds.length}: ID ${id}`);
                    }
                } catch (error) {
                    // Token doesn't exist or is burned, continue
                }
            }
        }

        return { balance: balanceNumber, tokenIds: tokenIds };
    } catch (error) {
        console.error('  ✗ Error checking NFT balance:', error.message);
        return { balance: 0, tokenIds: [] };
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
                            value: txn.value,
                            valueInEth: ethers.formatEther(txn.value || '0'),
                            to: TARGET_CONTRACT,
                            status: 'Success'
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

    return { count: successfulTxnCount, transactions: matchingTxns };
}

/**
 * Save results to JSON file
 */
function saveResultsToJSON(results) {
    // Extract last 26 characters from address (removing '0x' prefix)
    const shortId = results.address.slice(-26);
    const filename = path.join(__dirname, `${shortId}.json`);

    const jsonData = {
        address: results.address,
        shortId: shortId,
        nftBalance: results.nftBalance,
        nftTokenIds: results.nftTokenIds || [],
        multiplier: results.multiplier,
        multiplierReason: results.nftBalance >= 2 ? '2+ NFTs bonus' : results.nftBalance === 1 ? '1 NFT bonus' : 'No NFTs',
        successfulTransactions: results.txnCount,
        basePoints: results.basePoints,
        totalPoints: results.totalPoints,
        pointsPerTransaction: BASE_POINTS_PER_TXN,
        transactions: results.transactions,
        lastUpdated: new Date().toISOString()
    };

    fs.writeFileSync(filename, JSON.stringify(jsonData, null, 2));
    console.log(`\n✓ Results saved to: ${filename}`);
    return filename;
}

/**
 * Calculate total points for an address
 */
async function calculatePoints(address) {
    console.log('='.repeat(80));
    console.log(`POINTS AGGREGATOR - Address: ${address}`);
    console.log('='.repeat(80));

    // Check NFT holdings
    const nftData = await checkNFTBalance(address);
    const nftBalance = nftData.balance;
    const nftTokenIds = nftData.tokenIds;

    // Count successful transactions
    const txnResult = countSuccessfulTransactions(address);
    const txnCount = txnResult.count;
    const transactions = txnResult.transactions;

    // Calculate multiplier based on NFT holdings
    let multiplier;
    if (nftBalance === 0) {
        multiplier = NFT_MULTIPLIERS[0];
    } else if (nftBalance === 1) {
        multiplier = NFT_MULTIPLIERS[1];
    } else {
        multiplier = NFT_MULTIPLIERS[2];
    }

    // Calculate points
    const basePoints = txnCount * BASE_POINTS_PER_TXN;
    const totalPoints = Math.floor(basePoints * multiplier);

    // Display results
    console.log('\n' + '='.repeat(80));
    console.log('RESULTS');
    console.log('='.repeat(80));
    console.log(`NFT Balance: ${nftBalance} ${nftBalance > 0 ? '✓' : '✗'}`);
    if (nftTokenIds.length > 0) {
        console.log(`NFT Token IDs: [${nftTokenIds.join(', ')}]`);
    }
    console.log(`Multiplier: ${multiplier}x ${nftBalance >= 2 ? '(2+ NFTs bonus!)' : nftBalance === 1 ? '(1 NFT bonus)' : ''}`);
    console.log(`Successful Transactions: ${txnCount}`);
    console.log(`Base Points: ${basePoints} (${txnCount} txns × ${BASE_POINTS_PER_TXN} points)`);
    console.log(`Total Points: ${totalPoints} ${nftBalance > 0 ? '(with NFT bonus)' : ''}`);
    console.log('='.repeat(80));

    return {
        address,
        nftBalance,
        nftTokenIds,
        multiplier,
        txnCount,
        basePoints,
        totalPoints,
        transactions
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
            // Save results to JSON file
            saveResultsToJSON(result);
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
