/**
 * The public IP lookup through a proxy must leave through the proxy: Node
 * ignored the tunnelled socket and connected to the IP service itself, so
 * the lookup "through" a proxy answered with the host's own address.
 */
import * as net from "node:net";
import { expect, it } from "vitest";
import { InvalidIP } from "../../src/exceptions.js";
import { publicIP } from "../../src/ip.js";

it("fails with the proxy's tunnel rather than going around it", async () => {
	const targets: string[] = [];
	const server = net.createServer((socket) => {
		socket.once("data", (chunk) => {
			targets.push(chunk.toString().split(" ")[1]);
			// Grant the tunnel, then drop it before TLS can complete.
			socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
			socket.once("data", () => socket.destroy());
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as net.AddressInfo;
	try {
		await expect(publicIP(`http://127.0.0.1:${port}`)).rejects.toThrow(
			InvalidIP,
		);
	} finally {
		server.close();
	}
	expect(targets[0]).toBe("api.ipify.org:443");
});
