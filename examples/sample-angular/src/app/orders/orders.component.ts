import { Component, inject } from '@angular/core';
import { OrdersStore } from './orders.store';

@Component({
  selector: 'app-orders',
  standalone: true,
  templateUrl: './orders.component.html',
})
export class OrdersComponent {
  readonly store = inject(OrdersStore);

  refresh(): void {
    this.store.reload();
  }
}
