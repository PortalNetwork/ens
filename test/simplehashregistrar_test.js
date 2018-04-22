const WNS = artifacts.require('WNSRegistry.sol');
const AuctionRegistrar = artifacts.require('Registrar.sol');
const Deed = artifacts.require('Deed.sol');
const FIFS = artifacts.require('FIFSRegistrar.sol');
const PublicResolver = artifacts.require('PublicResolver.sol');
const ReverseResolver = artifacts.require('DefaultReverseResolver.sol');
const TestRegistrar = artifacts.require('TestRegistrar.sol');
const utils = require('./helpers/Utils.js');


var assert = require('assert');
var async = require('async');
var Promise = require('bluebird');

// var utils = require('./utils.js');
// var web3 = utils.web3;

var accounts = null;

before(function(done) {
	web3.eth.getAccounts(function(err, acct) {
		accounts = acct
		done();
	});
});

function advanceTime(delay, done) {
	web3.currentProvider.sendAsync({
		jsonrpc: "2.0",
		"method": "evm_increaseTime",
		params: [delay]}, done)
}
var advanceTimeAsync = Promise.promisify(advanceTime);

// days in secs
function days(numberOfDays) {
	return numberOfDays * 24 * 60 * 60;
}

function assertIsContractError(err) {
	return assert.ok(err.toString().indexOf("invalid JUMP") != -1, err);
}

describe('SimpleHashRegistrar', function() {
	var registrarABI = null;
	var registrarBytecode = null;
	var deedABI = null;
	var registrar = null;
	var ens = null;
	var throwingBidder = null;
	var launchLength = days(7 * 8);
	var bid;

	var dotEth = web3.sha3('0000000000000000000000000000000000000000000000000000000000000000' + web3.sha3('eth').slice(2), {encoding: 'hex'});
	var nameDotEth = web3.sha3(dotEth + web3.sha3('name').slice(2), {encoding: 'hex'});

	before(function() {
		// this.timeout(30000);
		// var code = utils.compileContract(['AbstractENS.sol', 'HashRegistrarSimplified.sol']);
		// registrarABI = JSON.parse(code.contracts['HashRegistrarSimplified.sol:Registrar'].interface);
		// registrarBytecode = code.contracts['HashRegistrarSimplified.sol:Registrar'].bytecode;
		// deedABI = JSON.parse(code.contracts['HashRegistrarSimplified.sol:Deed'].interface);
	});

	beforeEach(async () => {
		this.timeout(5000);
		ens = await WNS.new();
		registrar = await AuctionRegistrar.new(ens.address, dotEth, 0, {from: accounts[0], gas: 4700000});
		await ens.setSubnodeOwner(0, web3.sha3('eth'), registrar.address, {from: accounts[0]});
	});

	it('starts auctions', async () => {
		//advanceTime(launchLength, done);
		await advanceTimeAsync(launchLength);
		await registrar.startAuction(web3.sha3('name'), {from: accounts[0]});
		await advanceTimeAsync(days(2));
		await registrar.startAuction(web3.sha3('name'), {from: accounts[0]});

		var result = await registrar.entries(web3.sha3('name'));

		assert.equal(result[0], 1); // status == Auction
		assert.equal(result[1], 0); // deed == 0x00
		// Expected to end 5 days from start
		var expectedEnd = new Date().getTime() / 1000 + launchLength + days(5);
		assert.ok(Math.abs(result[2].toNumber() - expectedEnd) < 5); // registrationDate
		assert.equal(result[3], 0); // value = 0
		assert.equal(result[4], 0); // highestBid = 0

		await advanceTimeAsync(days(30));
		await registrar.startAuction(web3.sha3('anothername'), {from: accounts[0]});
		result = await registrar.entries(web3.sha3('anothername'));
		var expectedEnd = new Date().getTime() / 1000 + launchLength + days(37);
		assert.ok(Math.abs(result[2].toNumber() - expectedEnd) < 5); // registrationDate
	});

	it('launch starts slow with scheduled availability', async () => {
		var registryStarted = 0;
		var result = await registrar.registryStarted();
		registryStarted = Number(result);
		result = await registrar.getAllowedTime('0x00');
		assert.equal(Number(result) , registryStarted);

		result = await registrar.getAllowedTime('0x80');
		assert.equal(Number(result)-registryStarted , launchLength/2);

		result = await registrar.getAllowedTime('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
		assert.equal(Number(result)-registryStarted , launchLength-1);

		result = await registrar.getAllowedTime(web3.sha3('ethereum'));
		assert.equal(Math.round((Number(result)-registryStarted)/days(1)), 18);

		await advanceTimeAsync(days(1));

		result = await registrar.startAuction(web3.sha3('freedomhacker'), {from: accounts[0]});
		assert.ok(result != null);

		await registrar.startAuction(web3.sha3('ethereum'), {from: accounts[0]}).catch((error) => { utils.ensureException(error); });

		await registrar.startAuction(web3.sha3('unicorn'), {from: accounts[0]}).catch((error) => { utils.ensureException(error); });

		result = await registrar.entries(web3.sha3('freedomhacker'));
		assert.equal(result[0], 1);

		result = await registrar.entries(web3.sha3('ethereum'));
		assert.equal(result[0], 5); 

		result = await registrar.entries(web3.sha3('unicorn'));
		assert.equal(result[0], 5);

		await advanceTimeAsync(days(30));

		await registrar.startAuction(web3.sha3('ethereum'), {from: accounts[0]});

		result = await registrar.entries(web3.sha3('freedomhacker'));
		assert.equal(result[0], 0);

		result = await registrar.entries(web3.sha3('ethereum'));
		assert.equal(result[0], 1); 

		result = await registrar.entries(web3.sha3('unicorn'));
		assert.equal(result[0], 5); 

		await advanceTimeAsync(days(60));

		await registrar.startAuction(web3.sha3('unicorn'), {from: accounts[0]});

		result = await registrar.entries(web3.sha3('unicorn'));
		assert.equal(result[0], 1); 
	});

    it('records bids', async () => {	
    	bid = null;
    	await advanceTimeAsync(launchLength);

    	await registrar.startAuction(web3.sha3('name'), {from: accounts[0]});

    	bid = await registrar.shaBid(web3.sha3('name'), accounts[0], 1e18, 0);
    	await registrar.newBid(bid, {from: accounts[0], value: 2e18}).catch((error) => { utils.ensureException(error); });

    	deedAddress = await registrar.sealedBids(accounts[0], bid);
    	balance = await web3.eth.getBalance(deedAddress);
    	assert.equal(balance.toNumber(), 2e18);

    	await registrar.newBid(bid, {from: accounts[0], value: 1e15 - 1}).catch((error) => { utils.ensureException(error); });
    });

    it('concludes auctions', async () => {
		this.timeout(5000);
		var bidData = [
			// A regular bid
			{description: 'A regular bid', account: accounts[0], value: 1.1e18, deposit: 2.0e18, salt: 1, expectedFee: 0.005 },
			// A better bid
			{description: 'Winning bid', account: accounts[1], value: 2.0e18, deposit: 2.0e18, salt: 2, expectedFee: 0.75 },
			// Lower, but affects second place
			{description: 'Losing bid that affects price', account: accounts[2], value: 1.5e18, deposit: 2.0e18, salt: 3, expectedFee: 0.005 },
			// No effect
			{description: 'Losing bid that doesn\'t affect price', account: accounts[3], value: 1.2e18, deposit: 2.0e18, salt: 4, expectedFee: 0.005 },
			// Deposit smaller than value
			{description: 'Bid with deposit less than claimed value', account: accounts[4], value: 5.0e18, deposit: 1.0e17, salt: 5, expectedFee: 0.005 },
			// Invalid - doesn't reveal
			{description: 'Bid that wasn\'t revealed in time', account: accounts[5], value: 1.4e18, deposit: 2.0e18, salt: 6, expectedFee: 0.995 }
		];

        // moves past the soft launch dates
		await advanceTimeAsync(launchLength);

        // Save initial balances
		async.each(bidData, async (bid) => {
			balance = await web3.eth.getBalance(bid.account);
			console.log(balance.toNumber());
			bid.startingBalance = balance.toFixed();
		});

		// Start an auction for 'name'
		await registrar.startAuction(web3.sha3('name'), {from: accounts[0]});

		result = await registrar.entries(web3.sha3('name'));
		// Should be status 1 (Auction)
		assert.equal(result[0], 1);

		// Place each of the bids
		async.each(bidData, async (bid) => {
			bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
			txid = await registrar.newBid(bid.sealedBid, {from: bid.account, value: bid.deposit});
		});

		// Try to reveal a bid early
		await registrar.unsealBid(web3.sha3('name'), bidData[0].value, bidData[0].salt, {from: bidData[0].account}).catch((error) => { utils.ensureException(error); });

		// Advance 3 days to the reveal period
		await advanceTimeAsync(days(3) + 60);		

		// Start an auction for 'anothername' to force time update
		await registrar.startAuction(web3.sha3('anothername'), {from: accounts[0]});

		// checks status
		result = await registrar.entries(web3.sha3('name'));
		// Should be status 4 (Reveal)
		assert.equal(result[0], 4);

		// Reveal all the bids
		async.each(bidData, async (bid) => {
			if(bid.salt !== 6){
				console.log('bid.salt:' + bid.salt);
				txid = await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, {from: bid.account});
			}
		});

		// Advance another two days to the end of the auction
		await advanceTimeAsync(days(2));
		// Start an auction for 'anothername' to force time update
		await registrar.startAuction(web3.sha3('dummy'), {from: accounts[0]});

		// Finalize the auction
		console.log(accounts);
		txid = await registrar.finalizeAuction(web3.sha3('name'), {from: accounts[1], gas:4000000});

		//Reveal last bid
		bid = bidData[5];
		await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, {from: bid.account}).catch((error) => { utils.ensureException(error); });


		// 	// Check the name has the correct owner, value, and highestBid
		// 	function(done) {
		// 		registrar.entries(web3.sha3('name'), function(err, result) {
		// 			assert.equal(err, null, err);
		// 			assert.equal(result[0], 2); // status == Owned
		// 			assert.equal(result[3], 1.5e18); // value = 1.5 ether
		// 			assert.equal(result[4], 2e18); // highestBid = 2 ether
		// 			var deed = web3.eth.contract(deedABI).at(result[1]);
		// 			async.series([
		// 				// Check the owner is correct
		// 				function(done) {
		// 					deed.owner(function(err, addr) {
		// 						assert.equal(err, null, err);
		// 						assert.equal(addr, accounts[1]);
		// 						done();
		// 					});
		// 				},
		// 				// Check the registrar is correct
		// 				function(done) {
		// 					deed.registrar(function(err, addr) {
		// 						assert.equal(err, null, err);
		// 						assert.equal(addr, registrar.address);
		// 						done();
		// 					});
		// 				},
		// 				// Check the balance is correct
		// 				function(done) {
		// 					web3.eth.getBalance(result[1], function(err, balance) {
		// 						assert.equal(err, null, err);
		// 						assert.equal(balance.toNumber(), bidData[2].value);
		// 						done();
		// 					});
		// 				},
		// 				// Check the value is correct
		// 				function(done) {
		// 					deed.value(function(err, value) {
		// 						assert.equal(err, null, err);
		// 						assert.equal(value, bidData[2].value);
		// 						done();
		// 					});
		// 				}
		// 			], done);
		// 		});
		// 	},
		// 	// Check balances
		// 	function(done) {
		// 		async.each(bidData, function(bid, done) {
		// 			web3.eth.getBalance(bid.account, function(err, balance){
		// 				var spentFee = Math.floor(10000*(bid.startingBalance - balance.toFixed()) / Math.min(bid.value, bid.deposit))/10000;
		// 				console.log('\t Bidder #' + bid.salt, bid.description + '. Spent:', 100*spentFee + '%; Expected:', 100*bid.expectedFee + '%;');
		// 				assert.equal(spentFee, bid.expectedFee);
		// 				done();
		// 			});
		// 		}, done);
		// 	},
		// 	// Check the owner is set in ENS
		// 	function(done) {
		// 		ens.owner(nameDotEth, function(err, owner) {
		// 			assert.equal(err, null, err);
		// 			assert.equal(owner, accounts[1]);
		// 			done();
		// 		});
		// 	}
		// ], done);	
    });
});
