import { ProduceStatus } from '../../../generated/client';
import { deriveProduceStatus } from '../utils/produce-status';

describe('deriveProduceStatus', () => {
  it.each([
    { actualQuantity: 0, floatingQuantity: 0 },
    { actualQuantity: 10, floatingQuantity: 10 },
  ])('never moves a SOURCED listing ($actualQuantity in stock)', (stock) => {
    expect(deriveProduceStatus(ProduceStatus.SOURCED, stock)).toBe(
      ProduceStatus.SOURCED,
    );
  });
});
