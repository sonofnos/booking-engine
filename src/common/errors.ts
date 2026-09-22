import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

export class InsufficientInventoryError extends UnprocessableEntityException {
  constructor(available: number, requested: number) {
    super(`Insufficient inventory: ${available} available, ${requested} requested`);
  }
}

export class InventoryItemNotFoundError extends NotFoundException {
  constructor(id: string) {
    super(`Inventory item ${id} not found`);
  }
}

export class BookingNotFoundError extends NotFoundException {
  constructor(id: string) {
    super(`Booking ${id} not found`);
  }
}

export class InvalidBookingStateError extends ConflictException {
  constructor(current: string, action: string) {
    super(`Cannot ${action} a booking in state ${current}`);
  }
}

export class IdempotencyConflictError extends ConflictException {
  constructor(key: string) {
    super(`Idempotency key ${key} was already used with a different request`);
  }
}

export class PaymentDeclinedError extends UnprocessableEntityException {
  constructor(reason: string) {
    super(`Payment declined: ${reason}`);
  }
}
