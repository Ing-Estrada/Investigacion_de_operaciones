interface HeapEntry<T> {
  value: T;
  priority: number;
}

/**
 * Cola de prioridad sobre un heap binario. `push` y `pop` son O(log n), `peek` es O(1).
 *
 * No implementa decrease-key: Dijkstra y A* insertan una entrada nueva cada vez que
 * mejoran la distancia a un nodo y descartan las obsoletas al extraerlas. Esto sube el
 * tamaño del heap de O(V) a O(E), pero evita mantener un índice nodo→posición que hay
 * que actualizar en cada intercambio — con E ≈ 3V en una red vial real, el heap sigue
 * siendo pequeño y la constante es mejor.
 */
export class MinPriorityQueue<T> {
  private readonly heap: HeapEntry<T>[] = [];

  get size(): number {
    return this.heap.length;
  }

  get isEmpty(): boolean {
    return this.heap.length === 0;
  }

  push(value: T, priority: number): void {
    this.heap.push({ value, priority });
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;

    const top = this.heap[0];
    const last = this.heap.pop() as HeapEntry<T>;

    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }

    return top.value;
  }

  peek(): T | undefined {
    return this.heap[0]?.value;
  }

  private bubbleUp(startIndex: number): void {
    let index = startIndex;
    const entry = this.heap[index];

    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      if (this.heap[parentIndex].priority <= entry.priority) break;
      this.heap[index] = this.heap[parentIndex];
      index = parentIndex;
    }

    this.heap[index] = entry;
  }

  private bubbleDown(startIndex: number): void {
    let index = startIndex;
    const entry = this.heap[index];
    const length = this.heap.length;
    const halfLength = length >> 1;

    while (index < halfLength) {
      let childIndex = (index << 1) + 1;
      const rightIndex = childIndex + 1;

      if (rightIndex < length && this.heap[rightIndex].priority < this.heap[childIndex].priority) {
        childIndex = rightIndex;
      }

      if (this.heap[childIndex].priority >= entry.priority) break;

      this.heap[index] = this.heap[childIndex];
      index = childIndex;
    }

    this.heap[index] = entry;
  }
}
