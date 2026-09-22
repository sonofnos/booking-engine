import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { InventoryItem, InventoryType } from './entities/inventory-item.entity';
import { InsufficientInventoryError, InventoryItemNotFoundError } from '../common/errors';

@Injectable()
export class InventoryService {
  constructor(private readonly dataSource: DataSource) {}

  async create(input: { type: InventoryType; productRef: string; travelDate: string; totalUnits: number }): Promise<InventoryItem> {
    const repo = this.dataSource.getRepository(InventoryItem);
    return repo.save(repo.create(input));
  }

  async get(id: string): Promise<InventoryItem> {
    const item = await this.dataSource.getRepository(InventoryItem).findOne({ where: { id } });
    if (!item) throw new InventoryItemNotFoundError(id);
    return item;
  }

  /**
   * Locks the inventory row with SELECT ... FOR UPDATE and increments
   * heldUnits, inside the transaction the caller already opened. Two
   * concurrent requests for the last unit of the same item queue on this
   * lock; whichever commits first wins the unit, and the second reads the
   * now-updated row and correctly sees it unavailable. There is no
   * check-then-act race window between reading availability and writing
   * the hold, because the row is locked before either happens.
   */
  async holdUnits(manager: EntityManager, inventoryItemId: string, units: number): Promise<InventoryItem> {
    const item = await manager
      .createQueryBuilder(InventoryItem, 'item')
      .setLock('pessimistic_write')
      .where('item.id = :id', { id: inventoryItemId })
      .getOne();
    if (!item) throw new InventoryItemNotFoundError(inventoryItemId);

    const available = item.totalUnits - item.heldUnits - item.bookedUnits;
    if (available < units) throw new InsufficientInventoryError(available, units);

    item.heldUnits += units;
    return manager.save(item);
  }

  /** Moves units from held to booked -- called when a hold is confirmed (payment captured, GDS confirmed). */
  async convertHoldToBooked(manager: EntityManager, inventoryItemId: string, units: number): Promise<void> {
    const item = await manager.createQueryBuilder(InventoryItem, 'item').setLock('pessimistic_write').where('item.id = :id', { id: inventoryItemId }).getOne();
    if (!item) throw new InventoryItemNotFoundError(inventoryItemId);
    item.heldUnits = Math.max(0, item.heldUnits - units);
    item.bookedUnits += units;
    await manager.save(item);
  }

  /** Releases held (not yet booked) units back to available -- an expired or cancelled hold. */
  async releaseHeld(manager: EntityManager, inventoryItemId: string, units: number): Promise<void> {
    const item = await manager.createQueryBuilder(InventoryItem, 'item').setLock('pessimistic_write').where('item.id = :id', { id: inventoryItemId }).getOne();
    if (!item) throw new InventoryItemNotFoundError(inventoryItemId);
    item.heldUnits = Math.max(0, item.heldUnits - units);
    await manager.save(item);
  }

  /** Releases booked (previously confirmed) units back to available -- a cancellation after confirmation. */
  async releaseBooked(manager: EntityManager, inventoryItemId: string, units: number): Promise<void> {
    const item = await manager.createQueryBuilder(InventoryItem, 'item').setLock('pessimistic_write').where('item.id = :id', { id: inventoryItemId }).getOne();
    if (!item) throw new InventoryItemNotFoundError(inventoryItemId);
    item.bookedUnits = Math.max(0, item.bookedUnits - units);
    await manager.save(item);
  }
}
