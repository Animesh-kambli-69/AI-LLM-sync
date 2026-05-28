```java
class Node {
    int data;
    Node next;

    Node(int data) {
        this.data = data;
        this.next = null;
    }
}

class CircularLinkedList {
    Node head;

    void insert(int data) {
        Node newNode = new Node(data);
        if (head == null) {
            head = newNode;
            newNode.next = head;
        } else {
            Node temp = head;
            while (temp.next != head) {
                temp = temp.next;
            }
            temp.next = newNode;
            newNode.next = head;
        }
    }

    void delete(int key) {
        if (head == null) {
            return;
        }
        if (head.data == key && head.next == head) {
            head = null;
            return;
        }
        Node temp = head, prev = null;
        do {
            prev = temp;
            temp = temp.next;
        } while (temp != head && temp.data != key);
        if (temp == head) {
            prev.next = head;
        } else if (temp != null) {
            prev.next = temp.next;
        }
    }

    void display() {
        if (head == null) {
            System.out.println("List is empty");
            return;
        }
        Node temp = head;
        do {
            System.out.print(temp.data + " ");
            temp = temp.next;
        } while (temp != head);
        System.out.println();
    }
}

public class Main {
    public static void main(String[] args) {
        CircularLinkedList list = new CircularLinkedList();
        list.insert(10);
        list.insert(20);
        list.insert(30);
        list.insert(40);
        list.display();
        list.delete(20);
        list.display();
        list.delete(10);
        list.display();
        list.delete(30);
        list.display();
        list.delete(40);
        list.display();
    }
}
```