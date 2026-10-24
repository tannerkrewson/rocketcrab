import { createFileRoute } from "@tanstack/react-router";
import { JoinFlow } from "../components/party/JoinFlow";
export const Route = createFileRoute("/join")({ component: JoinFlow });
