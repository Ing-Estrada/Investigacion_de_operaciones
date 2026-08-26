import { MinPriorityQueue } from './priority-queue';

describe('MinPriorityQueue', () => {
  it('empieza vacía', () => {
    const queue = new MinPriorityQueue<string>();

    expect(queue.isEmpty).toBe(true);
    expect(queue.size).toBe(0);
    expect(queue.pop()).toBeUndefined();
    expect(queue.peek()).toBeUndefined();
  });

  it('extrae siempre el elemento de menor prioridad', () => {
    const queue = new MinPriorityQueue<string>();

    queue.push('media', 5);
    queue.push('alta', 1);
    queue.push('baja', 10);

    expect(queue.pop()).toBe('alta');
    expect(queue.pop()).toBe('media');
    expect(queue.pop()).toBe('baja');
    expect(queue.isEmpty).toBe(true);
  });

  it('mantiene el orden con inserciones y extracciones intercaladas', () => {
    const queue = new MinPriorityQueue<number>();

    queue.push(30, 30);
    queue.push(10, 10);
    expect(queue.pop()).toBe(10);

    queue.push(20, 20);
    queue.push(5, 5);
    expect(queue.pop()).toBe(5);
    expect(queue.pop()).toBe(20);
    expect(queue.pop()).toBe(30);
  });

  it('devuelve todo ordenado con 1000 prioridades aleatorias', () => {
    const queue = new MinPriorityQueue<number>();
    const priorities = Array.from({ length: 1000 }, () => Math.random() * 1000);

    for (const priority of priorities) queue.push(priority, priority);

    const extracted: number[] = [];
    while (!queue.isEmpty) extracted.push(queue.pop() as number);

    expect(extracted).toHaveLength(1000);
    expect(extracted).toEqual([...priorities].sort((a, b) => a - b));
  });

  it('admite prioridades duplicadas', () => {
    const queue = new MinPriorityQueue<string>();

    queue.push('a', 1);
    queue.push('b', 1);
    queue.push('c', 1);

    expect(queue.size).toBe(3);
    expect([queue.pop(), queue.pop(), queue.pop()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('peek no extrae el elemento', () => {
    const queue = new MinPriorityQueue<string>();
    queue.push('x', 1);

    expect(queue.peek()).toBe('x');
    expect(queue.size).toBe(1);
  });

  it('admite prioridades negativas y cero', () => {
    const queue = new MinPriorityQueue<string>();

    queue.push('cero', 0);
    queue.push('negativa', -5);
    queue.push('positiva', 5);

    expect(queue.pop()).toBe('negativa');
    expect(queue.pop()).toBe('cero');
    expect(queue.pop()).toBe('positiva');
  });
});
