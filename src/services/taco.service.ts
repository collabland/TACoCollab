import {
    Implementation,
    toMetaMaskSmartAccount,
} from '@metamask/delegation-toolkit';
import { SigningCoordinatorAgent } from '@nucypher/shared';
import { domains, initialize } from '@nucypher/taco';
import { ethers } from 'ethers';
import { Address } from 'viem';
import { createViemTacoAccount } from '../utils/taco-account';
import { Web3Service } from './web3.service';

export class TacoService {
  private static instance: TacoService;
  private initialized = false;
  private readonly TACO_DOMAIN = domains.DEVNET;
  private readonly COHORT_ID = 1;
  private readonly TACO_SIGNING_COORDINATOR_CHILD_ADDRESS = '0xcc537b292d142dABe2424277596d8FFCC3e6A12D';

  private constructor() {}

  public static getInstance(): TacoService {
    if (!TacoService.instance) {
      TacoService.instance = new TacoService();
    }
    return TacoService.instance;
  }

  public async initializeTaco(): Promise<void> {
    if (this.initialized) return;
    await initialize();
    this.initialized = true;
    console.log('TACo initialized');
  }

  public async createSmartAccount() {
    await this.initializeTaco();
    const web3 = Web3Service.getInstance();

    // Fetch cohort multisig
    const coordinator = new ethers.Contract(
        this.TACO_SIGNING_COORDINATOR_CHILD_ADDRESS,
        ['function cohortMultisigs(uint32) view returns (address)'],
        web3.signingChainProvider
    );
    const cohortMultisigAddress = await coordinator.cohortMultisigs(this.COHORT_ID);

    // Fetch participants/threshold
    const participants = await SigningCoordinatorAgent.getParticipants(
      web3.signingCoordinatorProvider,
      this.TACO_DOMAIN,
      this.COHORT_ID,
    );
    const threshold = await SigningCoordinatorAgent.getThreshold(
      web3.signingCoordinatorProvider,
      this.TACO_DOMAIN,
      this.COHORT_ID,
    );
    const signers = participants.map((p) => p.signerAddress as Address);

    const tacoAccount = createViemTacoAccount(cohortMultisigAddress as Address);

    const smartAccount = await toMetaMaskSmartAccount({
      // @ts-expect-error - Type incompatibility between viem versions
      client: web3.publicClient,
      implementation: Implementation.MultiSig,
      deployParams: [signers, BigInt(threshold)],
      deploySalt: '0x' as `0x${string}`, // Static salt for now, can be parameterized later
      signatory: [{ account: tacoAccount }],
    });

    return {
        address: smartAccount.address,
        threshold,
        deployed: false // Implementation.MultiSig is counterfactual
    };
  }
}
