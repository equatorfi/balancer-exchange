import { observable, action } from 'mobx';
import * as deployed from 'deployed.json';
import * as blockchain from 'utils/blockchain';
import * as helpers from 'utils/helpers';
import { RootStore } from 'stores/Root';
import sor from 'balancer-sor';
import { Decimal } from 'decimal.js';
import * as log from 'loglevel';

export const statusCodes = {
    NOT_LOADED: 0,
    PENDING: 1,
    ERROR: 2,
    SUCCESS: 3,
};

export default class ProxyStore {
    @observable previewPending: boolean;
    rootStore: RootStore;

    constructor(rootStore) {
        this.rootStore = rootStore;
        this.previewPending = false;
    }

    isPreviewPending() {
        return this.previewPending;
    }

    setPreviewPending(value) {
        this.previewPending = value;
    }

    /* 
        Swap Methods - Action
    */
    @action batchSwapExactIn = async (
        tokenIn,
        tokenAmountIn,
        tokenOut,
        minAmountOut,
        maxPrice
    ) => {
        const proxy = blockchain.loadObject(
            'ExchangeProxy',
            deployed.proxy,
            'ExchangeProxy'
        );
        let pools = await sor.getPoolsWithTokens(tokenIn, tokenOut);

        let poolData = [];

        pools.pools.forEach(p => {
            let tI = p.tokens.find(
                t => helpers.toChecksum(t.address) === tokenIn
            );
            let tO = p.tokens.find(
                t => helpers.toChecksum(t.address) === tokenOut
            );
            let obj: any = {};
            obj.id = helpers.toChecksum(p.id);
            obj.balanceIn = new Decimal(tI.balance);
            obj.balanceOut = new Decimal(tO.balance);
            obj.weightIn = new Decimal(tI.denormWeight).div(
                new Decimal(p.totalWeight)
            );
            obj.weightOut = new Decimal(tO.denormWeight).div(
                new Decimal(p.totalWeight)
            );
            obj.swapFee = new Decimal(p.swapFee);
            poolData.push(obj);
        });

        let gasPrice = 0.00000001; // 1 Gwei
        let gasPerTrade = 210000; // eg. 210k gas
        let outTokenEthPrice = 100;

        let costPerTrade = gasPrice * gasPerTrade; // eg. 210k gas @ 10 Gwei
        let costOutputToken = costPerTrade * outTokenEthPrice;

        let sorSwaps = sor.linearizedSolution(
            poolData,
            'swapExactIn',
            tokenAmountIn,
            20,
            costOutputToken
        );

        let swaps = [];
        for (let i = 0; i < sorSwaps.inputAmounts.length; i++) {
            let swapAmount = sorSwaps.inputAmounts[i].toString();
            let swap = [
                sorSwaps.selectedBalancers[i],
                helpers.toWei(swapAmount),
                helpers.toWei('0'),
                maxPrice,
            ];
            swaps.push(swap);
        }
        await proxy.methods
            .batchSwapExactIn(
                swaps,
                tokenIn,
                tokenOut,
                helpers.toWei(tokenAmountIn),
                minAmountOut
            )
            .send();
    };

    @action batchSwapExactOut = async (
        tokenIn,
        maxAmountIn,
        tokenOut,
        tokenAmountOut,
        maxPrice
    ) => {
        const proxy = blockchain.loadObject(
            'ExchangeProxy',
            deployed.proxy,
            'ExchangeProxy'
        );
        let pools = await sor.getPoolsWithTokens(tokenIn, tokenOut);

        let poolData = [];

        pools.pools.forEach(p => {
            let tI = p.tokens.find(
                t => helpers.toChecksum(t.address) === tokenIn
            );
            let tO = p.tokens.find(
                t => helpers.toChecksum(t.address) === tokenOut
            );
            let obj: any = {};
            obj.id = helpers.toChecksum(p.id);
            obj.balanceIn = new Decimal(tI.balance);
            obj.balanceOut = new Decimal(tO.balance);
            obj.weightIn = new Decimal(tI.denormWeight).div(p.totalWeight);
            obj.weightOut = new Decimal(tO.denormWeight).div(p.totalWeight);
            obj.swapFee = new Decimal(p.swapFee);
            poolData.push(obj);
        });

        let gasPrice = 0.00000001; // 1 Gwei
        let gasPerTrade = 210000; // eg. 210k gas
        let outTokenEthPrice = 100;

        let costPerTrade = gasPrice * gasPerTrade; // eg. 210k gas @ 10 Gwei
        let costOutputToken = costPerTrade * outTokenEthPrice;

        let sorSwaps = sor.linearizedSolution(
            poolData,
            'swapExactOut',
            tokenAmountOut,
            20,
            costOutputToken
        );

        let swaps = [];
        for (let i = 0; i < sorSwaps.inputAmounts.length; i++) {
            let swapAmount = sorSwaps.inputAmounts[i].toString();
            let swap = [
                sorSwaps.selectedBalancers[i],
                maxAmountIn,
                helpers.toWei(swapAmount),
                maxPrice,
            ];
            swaps.push(swap);
        }
        await proxy.methods
            .batchSwapExactOut(
                swaps,
                tokenIn,
                tokenOut,
                maxAmountIn,
                helpers.toWei(tokenAmountOut)
            )
            .send();
    };

    calcEffectivePrice(tokenAmountIn, tokenAmountOut) {
        const amountIn = new Decimal(tokenAmountIn);
        const amountOut = new Decimal(tokenAmountOut);
        const effectivePrice = amountIn.div(amountOut).toString();

        return effectivePrice;
    }

    /* 
        Swap Methods - Preview
    */
    previewBatchSwapExactIn = async (tokenIn, tokenOut, tokenAmountIn) => {
        const proxy = blockchain.loadObject(
            'ExchangeProxy',
            deployed.proxy,
            'ExchangeProxy'
        );
        console.log(
            '[Action] previewBatchSwapExactIn',
            tokenIn,
            tokenOut,
            tokenAmountIn
        );

        try {
            this.setPreviewPending(true);
            let pools = await sor.getPoolsWithTokens(tokenIn, tokenOut);

            let poolData = [];
            pools.pools.forEach(p => {
                let tI = p.tokens.find(
                    t => helpers.toChecksum(t.address) === tokenIn
                );
                let tO = p.tokens.find(
                    t => helpers.toChecksum(t.address) === tokenOut
                );
                let obj: any = {};
                obj.id = helpers.toChecksum(p.id);
                obj.balanceIn = new Decimal(tI.balance);
                obj.balanceOut = new Decimal(tO.balance);
                obj.weightIn = new Decimal(tI.denormWeight).div(p.totalWeight);
                obj.weightOut = new Decimal(tO.denormWeight).div(p.totalWeight);
                obj.swapFee = new Decimal(p.swapFee);
                poolData.push(obj);
            });

            let maxPrice = helpers.setPropertyToMaxUintIfEmpty();
            let minAmountOut = helpers.setPropertyToZeroIfEmpty();

            let gasPrice = 0.00000001; // 1 Gwei
            let gasPerTrade = 210000; // eg. 210k gas
            let outTokenEthPrice = 100;

            let costPerTrade = gasPrice * gasPerTrade; // eg. 210k gas @ 10 Gwei
            let costOutputToken = costPerTrade * outTokenEthPrice;

            let sorSwaps = sor.linearizedSolution(
                poolData,
                'swapExactIn',
                tokenAmountIn,
                20,
                costOutputToken
            );

            let swaps = [];
            for (let i = 0; i < sorSwaps.inputAmounts.length; i++) {
                let swapAmount = sorSwaps.inputAmounts[i].toString();
                let swap = [
                    sorSwaps.selectedBalancers[i],
                    helpers.toWei(swapAmount),
                    helpers.toWei('0'),
                    maxPrice,
                ];
                swaps.push(swap);
            }

            const preview = await proxy.methods
                .batchSwapExactIn(
                    swaps,
                    tokenIn,
                    tokenOut,
                    helpers.toWei(tokenAmountIn),
                    minAmountOut
                )
                .call();

            const effectivePrice = this.calcEffectivePrice(
                tokenAmountIn,
                helpers.fromWei(preview)
            );

            const data = {
                outputAmount: preview,
                effectivePrice,
                swaps,
                validSwap: true,
            };
            this.setPreviewPending(false);
            return data;
        } catch (e) {
            log.error('[Error] previewSwapExactAmountIn', e);
            this.setPreviewPending(false);
            return {
                validSwap: false,
            };
        }
    };

    previewBatchSwapExactOut = async (tokenIn, tokenOut, tokenAmountOut) => {
        const proxy = blockchain.loadObject(
            'ExchangeProxy',
            deployed.proxy,
            'ExchangeProxy'
        );
        console.log(
            '[Action] previewBatchSwapExactOut',
            tokenIn,
            tokenOut,
            tokenAmountOut
        );

        try {
            this.setPreviewPending(true);
            let pools = await sor.getPoolsWithTokens(tokenIn, tokenOut);

            let poolData = [];
            pools.pools.forEach(p => {
                let tI = p.tokens.find(
                    t => helpers.toChecksum(t.address) === tokenIn
                );
                let tO = p.tokens.find(
                    t => helpers.toChecksum(t.address) === tokenOut
                );
                let obj: any = {};
                obj.id = helpers.toChecksum(p.id);
                obj.balanceIn = new Decimal(tI.balance);
                obj.balanceOut = new Decimal(tO.balance);
                obj.weightIn = new Decimal(tI.denormWeight).div(
                    new Decimal(p.totalWeight)
                );
                obj.weightOut = new Decimal(tO.denormWeight).div(
                    new Decimal(p.totalWeight)
                );
                obj.swapFee = new Decimal(p.swapFee);
                poolData.push(obj);
            });

            let maxPrice = helpers.setPropertyToMaxUintIfEmpty();
            let maxAmountIn = helpers.setPropertyToMaxUintIfEmpty();

            let gasPrice = 0.00000001; // 1 Gwei
            let gasPerTrade = 210000; // eg. 210k gas
            let outTokenEthPrice = 100;

            let costPerTrade = gasPrice * gasPerTrade; // eg. 210k gas @ 10 Gwei
            let costOutputToken = costPerTrade * outTokenEthPrice;

            let sorSwaps = sor.linearizedSolution(
                poolData,
                'swapExactOut',
                tokenAmountOut,
                20,
                costOutputToken
            );

            let swaps = [];
            for (let i = 0; i < sorSwaps.inputAmounts.length; i++) {
                let swapAmount = sorSwaps.inputAmounts[i].toString();
                let swap = [
                    sorSwaps.selectedBalancers[i],
                    maxAmountIn,
                    helpers.toWei(swapAmount),
                    maxPrice,
                ];
                swaps.push(swap);
            }

            const preview = await proxy.methods
                .batchSwapExactOut(
                    swaps,
                    tokenIn,
                    tokenOut,
                    helpers.toWei(tokenAmountOut),
                    maxAmountIn
                )
                .call();

            const effectivePrice = this.calcEffectivePrice(
                tokenAmountOut,
                helpers.fromWei(preview)
            );

            const data = {
                inputAmount: preview,
                effectivePrice,
                swaps,
                validSwap: true,
            };

            this.setPreviewPending(false);
            return data;
        } catch (e) {
            log.error('[Error] previewSwapExactAmountOut', e);
            this.setPreviewPending(false);
            return {
                validSwap: false,
            };
        }
    };
}