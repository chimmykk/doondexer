const { ethers } = require('ethers');

// Configuration
const RPC_URL = "https://rpc3.monad.xyz";
const NFT_CONTRACT_ADDRESS = "0x202b6523e33369722C170F41599ec32722181480";
const USER_ADDRESS = "0x84A7818F15D42e77EC028DDe50D84Db82FEBf46D";

// ERC721 ABI - only the functions we need
const ERC721_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function totalSupply() view returns (uint256)"
];

async function fetchNFTBalance() {
    try {
        console.log('Connecting to Monad RPC');
        console.log(`RPC URL: ${RPC_URL}`);
        console.log(`NFT Contract: ${NFT_CONTRACT_ADDRESS}`);
        console.log(`User Address: ${USER_ADDRESS}`);
        console.log('');

        // Create provider
        const provider = new ethers.JsonRpcProvider(RPC_URL);

        // Create contract instance
        const nftContract = new ethers.Contract(
            NFT_CONTRACT_ADDRESS,
            ERC721_ABI,
            provider
        );

        // Get balance
        console.log('Fetching NFT balance...');
        const balance = await nftContract.balanceOf(USER_ADDRESS);
        const balanceNumber = Number(balance);

        console.log(`Balance: ${balanceNumber} NFTs owned by ${USER_ADDRESS}`);
        console.log('');

        // If balance is 0, no need to enumerate
        if (balanceNumber === 0) {
            console.log('User owns 0 NFTs from this collection');
            return {
                balance: 0,
                tokenIds: []
            };
        }

        // Enumerate token IDs
        console.log(`Enumerating token IDs (${balanceNumber} tokens)...`);
        const tokenIds = [];
        let method1Success = false;

        // Method 1: Try tokenOfOwnerByIndex (more efficient)
        try {
            console.log('Trying Method 1: tokenOfOwnerByIndex...');
            for (let i = 0; i < balanceNumber; i++) {
                const tokenId = await nftContract.tokenOfOwnerByIndex(USER_ADDRESS, i);
                tokenIds.push(tokenId.toString());
                console.log(`  ✓ Token #${i + 1}: ID ${tokenId.toString()}`);
            }
            method1Success = true;
            console.log('Method 1 successful!');
        } catch (error) {
            console.log('Method 1 failed:', error.message);
            console.log('Falling back to Method 2...');
            tokenIds.length = 0; // Reset
        }

        // Method 2: Fallback to ownerOf enumeration
        if (!method1Success) {
            console.log('Trying Method 2: ownerOf enumeration...');

            // Try to get total supply to limit search range
            let maxCheck = 10000;
            try {
                const totalSupply = await nftContract.totalSupply();
                maxCheck = Math.min(Number(totalSupply), 10000);
                console.log(`  Total supply: ${maxCheck} tokens`);
            } catch (error) {
                console.log('  totalSupply not available, using default range');
                maxCheck = Math.min(10000, balanceNumber * 20);
            }

            console.log(`  Checking token IDs from 1 to ${maxCheck}...`);

            for (let id = 1; id <= maxCheck && tokenIds.length < balanceNumber; id++) {
                try {
                    const owner = await nftContract.ownerOf(id);

                    if (owner.toLowerCase() === USER_ADDRESS.toLowerCase()) {
                        tokenIds.push(id.toString());
                        console.log(`  ✓ Token #${tokenIds.length}: ID ${id}`);
                    }
                } catch (error) {
                    // Token doesn't exist or is burned, continue
                }
            }

            if (tokenIds.length === balanceNumber) {
                console.log('Method 2 successful!');
            } else {
                console.log(`Method 2 incomplete: found ${tokenIds.length}/${balanceNumber} tokens`);
            }
        }

        console.log('');
        console.log('='.repeat(80));
        console.log('RESULTS');
        console.log('='.repeat(80));
        console.log(`NFT Balance: ${balanceNumber}`);
        console.log(`Token IDs Owned:`);
        tokenIds.forEach((tokenId, index) => {
            console.log(`  ${index + 1}. Token ID: ${tokenId}`);
        });
        console.log('='.repeat(80));

        return {
            balance: balanceNumber,
            tokenIds: tokenIds
        };

    } catch (error) {
        console.error('Error fetching NFT balance:');
        console.error(error);
        throw error;
    }
}

// Run the function
if (require.main === module) {
    fetchNFTBalance()
        .then(result => {
            console.log('');
            console.log('Done!');
            process.exit(0);
        })
        .catch(error => {
            console.error('');
            console.error('Script failed');
            process.exit(1);
        });
}

module.exports = { fetchNFTBalance };
