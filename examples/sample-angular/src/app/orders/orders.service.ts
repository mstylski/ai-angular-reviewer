import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export interface Order {
  id: number;
  label: string;
}

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly updates = new Subject<Order[]>();

  getOrders(): Observable<Order[]> {
    return this.updates.asObservable();
  }

  publish(orders: Order[]): void {
    this.updates.next(orders);
  }
}
