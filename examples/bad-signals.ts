import { effect, signal } from '@angular/core';

export class ShoppingList {
  readonly items = signal<string[]>([]);
  readonly itemCount = signal(0);

  constructor() {
    effect(() => {
      this.itemCount.set(this.items().length);
    });
  }

  addItem(item: string): void {
    this.items().push(item);
  }
}
