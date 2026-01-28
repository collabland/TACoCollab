import { optionalEnv } from './env';

export type InfuraNetwork = 'mainnet' | 'sepolia';

export function getInfuraRpcUrl(network: InfuraNetwork): string {
  const projectId = optionalEnv('INFURA_PROJECT_ID');
  if (!projectId) throw new Error('INFURA_PROJECT_ID is not set');
  // Infura format: https://<network>.infura.io/v3/<projectId>
  return `https://${network}.infura.io/v3/${projectId}`;
}

export function getPimlicoBundlerUrl(chainId: number): string {
  const apiKey = optionalEnv('PIMLICO_API_KEY');
  if (!apiKey) throw new Error('PIMLICO_API_KEY is not set');
  // Pimlico format: https://api.pimlico.io/v2/<chainId>/rpc?apikey=<apiKey>
  return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${apiKey}`;
}
