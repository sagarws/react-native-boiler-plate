import type { ContractCase } from '../harness';

const cases: ContractCase[] = [
  { name: 'GET / hello', method: 'GET', path: '/' },
  { name: 'unknown route 404 page', method: 'GET', path: '/api/__contract_nope__/x' },
  { name: 'cors preflight', method: 'OPTIONS', path: '/api/common', headers: { origin: 'https://app.trackvid.in', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } },
];
export default cases;
