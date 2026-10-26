import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import java.io.IOException;
import java.net.*;
import java.nio.file.*;
import java.util.List;

class FixtureTest {
    @Test void actualTestWorkerAndTrustedDependency() {
        assertNotNull(System.getProperty("org.gradle.test.worker"));
        assertEquals("VERIFIED_MAC_GRADLE", Fixture.value());
    }
    @Test void localTcpAndWildcardUdpWork() throws Exception {
        try (ServerSocket server = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"));
             Socket client = new Socket("127.0.0.1", server.getLocalPort());
             Socket accepted = server.accept()) {
            client.getOutputStream().write(42);
            assertEquals(42, accepted.getInputStream().read());
        }
        try (DatagramSocket receiver = new DatagramSocket(0, InetAddress.getByName("0.0.0.0"));
             DatagramSocket sender = new DatagramSocket()) {
            receiver.setSoTimeout(1000);
            sender.send(new DatagramPacket(new byte[]{42}, 1, InetAddress.getByName("127.0.0.1"), receiver.getLocalPort()));
            DatagramPacket packet = new DatagramPacket(new byte[1], 1);
            receiver.receive(packet);
            assertEquals(42, packet.getData()[0]);
        }
    }
    @Test void externalIpv4AndIpv6TcpUdpCannotLeave() throws Exception {
        for (String address : List.of("1.1.1.1", "2606:4700:4700::1111")) {
            try (Socket socket = new Socket()) {
                assertThrows(IOException.class, () -> socket.connect(new InetSocketAddress(address, 443), 500));
            }
        }
        for (String address : List.of("192.0.2.1", "2001:db8::1")) {
            try (DatagramSocket socket = new DatagramSocket()) {
                assertThrows(IOException.class, () -> socket.send(new DatagramPacket(new byte[1], 1, InetAddress.getByName(address), 9)));
            }
        }
        assertFalse(Files.readString(Path.of("/proc/net/route")).contains("00000000\t00000000\t0003"));
    }
    @Test void hostLoopbackAndHostFilesAreNotShared() throws Exception {
        List<String> targets = Files.readAllLines(Path.of("/work/attack-targets.txt"));
        try (Socket socket = new Socket()) {
            int hostPort = Integer.parseInt(targets.get(0));
            assertThrows(IOException.class, () -> socket.connect(new InetSocketAddress("127.0.0.1", hostPort), 500));
        }
        for (String file : targets.subList(1, targets.size())) {
            assertThrows(IOException.class, () -> Files.readString(Path.of(file)));
        }
        assertThrows(IOException.class, () -> Files.readString(Path.of("/work/.env.canary")));
        assertThrows(IOException.class, () -> Files.readString(Path.of("/work/canary.pem")));
    }
    @Test void commandsCannotWriteSourceToolsOrArtifacts() throws Exception {
        Files.writeString(Path.of("/work/generated-control.txt"), "PRIVATE_BUILD_ONLY");
        assertEquals("PRIVATE_BUILD_ONLY", Files.readString(Path.of("/work/generated-control.txt")));
        for (String file : List.of("/source/command-attempt.txt", "/trusted/jdk/release", "/trusted/gradle/LICENSE", "/trusted/maven/org/jetbrains/annotations/26.0.2/annotations-26.0.2.jar")) {
            assertThrows(IOException.class, () -> Files.writeString(Path.of(file), "BAD"));
        }
        assertNotEquals(0, new ProcessBuilder("/bin/sh", "-c", "echo BAD >/source/command-attempt.txt").start().waitFor());
        assertFalse(Files.exists(Path.of("/var/run/docker.sock")));
        String status = Files.readString(Path.of("/proc/self/status"));
        assertTrue(status.contains("CapEff:\t0000000000000000"));
        assertTrue(status.contains("NoNewPrivs:\t1"));
    }
}
