# Stateful NFTs v2.0 Implementation

1. Paima Utils has a constant hardcoded list of `allowedStatefulNFTContracts` (will initially just be Paima NFTs, and likely won't expand past 2 ever)
2. When stats/perpetual player state is going to be updated (ex. after a match closes to update win count), we take the player address and check their set NFT in the nfts table.
3. If the set NFT is an NFT with a contract address that matches one of the `allowedStatefulNFTContracts`, then the player has set a stateful NFT and we can continue (if not, skip following steps and apply stats/state update to player address directly).
4. Once acknowledged that the NFT is stateful, then we must verify that the address still owns the NFT. This requires querying the NFT ownership table of the given contract (enabled by chain data extensions) and checking that the current owner matches the user's address who set said NFT.
5. Thus if the NFT is stateful, and the user still owns the NFT, then whatever stats/state update that was generated by the user is applied to the NFT's state in the `stateful_nfts` table, rather than the `global_player_state` table.