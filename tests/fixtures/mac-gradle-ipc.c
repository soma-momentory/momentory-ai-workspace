#include <arpa/inet.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

/* Controlled loopback-only syscall probe; no external destinations or input. */
int main(void) {
    for (int ipv6 = 0; ipv6 <= 1; ipv6++) {
        for (int tcp = 0; tcp <= 1; tcp++) {
            int fd = socket(ipv6 ? AF_INET6 : AF_INET, tcp ? SOCK_STREAM : SOCK_DGRAM, 0);
            printf("IPv%d %s socket=%d errno=%d\n", ipv6 ? 6 : 4, tcp ? "TCP" : "UDP", fd >= 0, fd < 0 ? errno : 0);
            if (fd < 0) continue;
            struct sockaddr_storage address = {0};
            socklen_t length = ipv6 ? sizeof(struct sockaddr_in6) : sizeof(struct sockaddr_in);
            if (ipv6) { struct sockaddr_in6 *a = (void *)&address; a->sin6_family = AF_INET6; a->sin6_addr = in6addr_any; }
            else { struct sockaddr_in *a = (void *)&address; a->sin_family = AF_INET; a->sin_addr.s_addr = htonl(INADDR_ANY); }
            int bound = bind(fd, (void *)&address, length);
            printf("IPv%d %s wildcard-bind=%d errno=%d\n", ipv6 ? 6 : 4, tcp ? "TCP" : "UDP", bound == 0, bound < 0 ? errno : 0);
            if (bound == 0 && tcp) {
                int listening = listen(fd, 1);
                printf("IPv%d TCP wildcard-listen=%d errno=%d\n", ipv6 ? 6 : 4, listening == 0, listening < 0 ? errno : 0);
            } else if (bound == 0) {
                getsockname(fd, (void *)&address, &length);
                if (ipv6) ((struct sockaddr_in6 *)&address)->sin6_addr = in6addr_loopback;
                else ((struct sockaddr_in *)&address)->sin_addr.s_addr = htonl(INADDR_LOOPBACK);
                int sent = sendto(fd, "X", 1, 0, (void *)&address, length);
                printf("IPv%d UDP loopback-send=%d errno=%d\n", ipv6 ? 6 : 4, sent == 1, sent < 0 ? errno : 0);
                struct timeval timeout = {0, 100000}; setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
                char byte = 0; int received = recvfrom(fd, &byte, 1, 0, NULL, NULL);
                printf("IPv%d UDP loopback-receive=%d errno=%d\n", ipv6 ? 6 : 4, received == 1 && byte == 'X', received < 0 ? errno : 0);
            }
            close(fd);
        }
    }
    return 0;
}
