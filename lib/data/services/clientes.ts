import { Client } from "@/lib/types";
import { dataRequest } from "../client";

export async function getClientes(): Promise<Client[]> { return dataRequest<Client[]>("clients.list"); }
export async function getClienteById(id: string): Promise<Client | null> { return dataRequest<Client | null>("clients.get", { id }); }
export async function createCliente(client: Partial<Client>): Promise<Client> { return dataRequest<Client>("clients.create", client); }
export async function updateCliente(id: string, client: Partial<Client>): Promise<Client> { return dataRequest<Client>("clients.update", { id, ...client }); }
export type ClientDeleteResult = { id: string; deleted: boolean; archived: boolean; message: string };
export async function deleteCliente(id: string): Promise<ClientDeleteResult> { return dataRequest<ClientDeleteResult>("clients.delete", { id }); }
