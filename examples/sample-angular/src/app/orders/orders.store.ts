import { Injectable, inject, signal } from '@angular/core';
import { OrdersService, type Order } from './orders.service';

@Injectable({ providedIn: 'root' })
export class OrdersStore {
  private readonly service = inject(OrdersService);
  readonly orders = signal<Order[]>([]);

  reload(): void {
    this.service.getOrders().subscribe((orders) => this.orders.set(orders));
  }

  renameFirst(label: string): void {
    const first = this.orders()[0];
    if (first) first.label = label;
  }
}
