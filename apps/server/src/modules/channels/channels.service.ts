import { InterfaceBindingRepository } from "./channel-account.repository.js";

export class InterfaceBindingsService {
  constructor(private readonly repository = new InterfaceBindingRepository()) {}

  listBindings() {
    return this.repository.list();
  }
}
