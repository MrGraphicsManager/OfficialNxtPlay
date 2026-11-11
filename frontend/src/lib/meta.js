import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const useMeta = () =>
  useQuery({ queryKey: ["meta"], queryFn: async () => (await api.get("/meta")).data });
