import type { DeliveryTask } from "./types/DeliveryTask.js";

const tasks: DeliveryTask[] = [];

export class DeliveryRepository {
  enqueue(task: DeliveryTask) {
    tasks.push(task);
    return task;
  }

  listPending() {
    return tasks;
  }
}
