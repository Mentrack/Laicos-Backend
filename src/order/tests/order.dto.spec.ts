import 'reflect-metadata';
import { OrderDto } from '../dto';

describe('OrderDto', () => {
  it('documents the sourced flag the buyer and farmer both receive', () => {
    const properties = Reflect.getMetadata(
      'swagger/apiModelPropertiesArray',
      OrderDto.prototype,
    ) as string[];
    expect(properties).toContain(':sourced');
  });
});
