public class CrashProbe {
    public static void main(String[] args) throws Exception {
        Process child = new ProcessBuilder("/bin/sh", "-c", "trap '' TERM; sleep 120").start();
        System.out.println("GRADLE_CRASH_CHILD_READY pid=" + ProcessHandle.current().pid() + " child=" + child.pid());
        System.out.flush();
        child.waitFor();
    }
}
