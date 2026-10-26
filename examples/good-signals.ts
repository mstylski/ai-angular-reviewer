import { computed, signal } from '@angular/core';

export class CounterStore {
    readonly count = signal(0);
    readonly doubled = computed(() => this.count() * 2);

    increment(): void {
        this.count.update(value => value + 1);
    }
}