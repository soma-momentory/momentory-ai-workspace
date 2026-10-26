// Evidence analysis only: verifies bytes, never approves a key or executes artifacts.
// Compile/run with the pinned Temurin JDK and Bouncy Castle jars from Gradle 9.1.0.
import java.io.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.Security;
import java.time.Instant;
import java.util.*;
import java.util.regex.*;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.openpgp.*;
import org.bouncycastle.openpgp.operator.jcajce.*;

public class VerifySignatures {
    record Key(PGPPublicKey key, PGPPublicKey master, String source) {}
    static final Map<Long,List<Key>> keys = new HashMap<>();
    static String hex(byte[] b) { return HexFormat.of().withUpperCase().formatHex(b); }
    static String json(Object x) {
        if(x==null)return "null";
        if(x instanceof Number || x instanceof Boolean)return x.toString();
        if(x instanceof Map<?,?> m){var a=new ArrayList<String>();m.forEach((k,v)->a.add(json(k.toString())+":"+json(v)));return "{"+String.join(",",a)+"}";}
        if(x instanceof Collection<?> c){return "["+String.join(",",c.stream().map(VerifySignatures::json).toList())+"]";}
        var b=new StringBuilder("\"");for(char c:x.toString().toCharArray()){switch(c){case '"' -> b.append("\\\"");case '\\' -> b.append("\\\\");case '\n' -> b.append("\\n");case '\r' -> b.append("\\r");case '\t' -> b.append("\\t");default -> {if(c<32)b.append(String.format("\\u%04x",(int)c));else b.append(c);}}}return b.append('"').toString();
    }
    static void load(Path file) throws Exception {
        // KEYS prose can use legacy encodings; armored payloads are strictly ASCII.
        var text=new String(Files.readAllBytes(file),StandardCharsets.ISO_8859_1);
        var blocks=Pattern.compile("-----BEGIN PGP PUBLIC KEY BLOCK-----[\\s\\S]*?-----END PGP PUBLIC KEY BLOCK-----").matcher(text);
        while(blocks.find()){
            try(var in=PGPUtil.getDecoderStream(new ByteArrayInputStream(blocks.group().getBytes(StandardCharsets.US_ASCII)))){
                var rings=new PGPPublicKeyRingCollection(in,new JcaKeyFingerprintCalculator());
                for(var ring:rings){var master=ring.getPublicKey();for(var key:ring)keys.computeIfAbsent(key.getKeyID(),n->new ArrayList<>()).add(new Key(key,master,file.getFileName().toString()));}
            }
        }
    }
    static boolean binding(Key k) throws Exception {
        if(k.key.isMasterKey())return true;
        var signatures=k.key.getSignaturesOfType(PGPSignature.SUBKEY_BINDING);
        while(signatures.hasNext()){
            var s=signatures.next();if(s.getKeyID()!=k.master.getKeyID())continue;
            try{s.init(new JcaPGPContentVerifierBuilderProvider().setProvider("BC"),k.master);if(s.verifyCertification(k.master,k.key))return true;}
            catch(PGPException incompatibleCertificate){/* Not a valid binding by this primary key. */}
        }
        return false;
    }
    static Map<String,Object> check(Path artifact,Path signature) throws Exception {
        var r=new LinkedHashMap<String,Object>();
        try(var in=PGPUtil.getDecoderStream(Files.newInputStream(signature))){
            var factory=new PGPObjectFactory(in,new JcaKeyFingerprintCalculator());
            Object obj=factory.nextObject();if(obj instanceof PGPMarker)obj=factory.nextObject();
            if(obj instanceof PGPCompressedData compressed){
                byte[] decoded;
                try(var stream=compressed.getDataStream()){decoded=stream.readNBytes(65537);}
                if(decoded.length>65536)throw new IOException("Compressed signature exceeds 64 KiB");
                obj=new PGPObjectFactory(decoded,new JcaKeyFingerprintCalculator()).nextObject();
                r.put("compressedSignature",true);
            }
            if(!(obj instanceof PGPSignatureList list)||list.isEmpty()){r.put("status","PARSE_FAILED");return r;}
            var results=new ArrayList<Map<String,Object>>();
            for(var s:list){
                var v=new LinkedHashMap<String,Object>();v.put("keyId",String.format("%016X",s.getKeyID()));v.put("createdAt",s.getCreationTime().toInstant().toString());v.put("hashAlgorithm",s.getHashAlgorithm());v.put("publicKeyAlgorithm",s.getKeyAlgorithm());v.put("signatureType",s.getSignatureType());
                var hashed=s.getHashedSubPackets();var issuer=hashed==null?null:hashed.getIssuerFingerprint();if(issuer!=null)v.put("declaredFingerprint",hex(issuer.getFingerprint()));
                var candidates=new ArrayList<>(keys.getOrDefault(s.getKeyID(),List.of()));
                // Refreshed complete certificates precede Gradle's reduced keyring.
                candidates.sort(Comparator.comparingInt(k->k.source.startsWith("keyserver-")?0:1));
                v.put("status",candidates.isEmpty()?"KEY_MISSING":"INVALID");
                var sources=new TreeSet<String>();for(var c:candidates)sources.add(c.source);v.put("keySources",sources);
                for(var k:candidates){
                    if(issuer!=null&&!Arrays.equals(issuer.getFingerprint(),k.key.getFingerprint()))continue;
                    s.init(new JcaPGPContentVerifierBuilderProvider().setProvider("BC"),k.key);
                    try(var bytes=Files.newInputStream(artifact)){var buf=new byte[65536];int n;while((n=bytes.read(buf))!=-1)s.update(buf,0,n);}
                    if(!s.verify())continue;
                    var matchingSources=new TreeSet<String>();
                    for(var c:candidates)if(Arrays.equals(c.key.getFingerprint(),k.key.getFingerprint())&&Arrays.equals(c.master.getFingerprint(),k.master.getFingerprint()))matchingSources.add(c.source);
                    v.put("keySources",matchingSources);
                    v.put("status","VALID");v.put("fingerprint",hex(k.key.getFingerprint()));v.put("primaryFingerprint",hex(k.master.getFingerprint()));
                    v.put("keyCreatedAt",k.key.getCreationTime().toInstant().toString());v.put("primaryCreatedAt",k.master.getCreationTime().toInstant().toString());v.put("keyBits",k.key.getBitStrength());v.put("bindingVerified",binding(k));
                    v.put("keyRevokedPacketPresent",k.key.hasRevocation()||k.master.hasRevocation());
                    v.put("keyExpiresAt",k.key.getValidSeconds()==0?null:k.key.getCreationTime().toInstant().plusSeconds(k.key.getValidSeconds()).toString());
                    v.put("primaryExpiresAt",k.master.getValidSeconds()==0?null:k.master.getCreationTime().toInstant().plusSeconds(k.master.getValidSeconds()).toString());
                    v.put("signatureExpiresAt",hashed==null||hashed.getSignatureExpirationTime()==0?null:s.getCreationTime().toInstant().plusSeconds(hashed.getSignatureExpirationTime()).toString());
                    var uids=new ArrayList<String>();k.master.getUserIDs().forEachRemaining(uids::add);v.put("userIds",uids);break;
                }
                results.add(v);
            }
            r.put("signatures",results);r.put("status",results.stream().anyMatch(v->"VALID".equals(v.get("status")))?"VALID":results.get(0).get("status"));
        }
        return r;
    }
    public static void main(String[] args) throws Exception {
        Security.addProvider(new BouncyCastleProvider());
        try(var paths=Files.list(Path.of(args[0]))){for(var file:paths.filter(p->p.toString().endsWith(".asc")&&!p.getFileName().toString().equals("gradlePolicy.asc")).sorted().toList())load(file);}
        for(var row:Files.readAllLines(Path.of(args[1]))){var cells=row.split("\t",-1);var r=new LinkedHashMap<String,Object>();r.put("path",cells[0]);try{r.putAll(check(Path.of(cells[1]),Path.of(cells[2])));}catch(Exception e){r.put("status","PARSE_FAILED");r.put("error",e.toString()+"; cause="+e.getCause());}System.out.println(json(r));}
    }
}
