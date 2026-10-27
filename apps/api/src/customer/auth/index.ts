/**
 * Customer auth for other modules (commerce): guards need only the global SessionService,
 * so importing them requires no module import.
 *
 *   @UseGuards(CustomerGuard)         handler(@CustomerId() id: string)
 *   @UseGuards(OptionalCustomerGuard) handler(@OptionalCustomerId() id: string | null)
 */
export {
  CustomerGuard,
  CustomerId,
  OptionalCustomerGuard,
  OptionalCustomerId,
} from './customer.guard';
